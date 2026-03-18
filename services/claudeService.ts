import { PDFDocument } from "pdf-lib";
import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import { DocumentData, ExtractionResponse } from "../types";
import { AppConfig } from "../config";

// Helper to access nested properties safely with dot notation
const getNestedValue = (obj: any, path: string) => {
  return path.split(".").reduce((prev, curr) => (prev ? prev[curr] : undefined), obj);
};

// Document types that store their reference in type-specific fields, not metadata.reference_number
const TYPES_WITHOUT_METADATA_REF = new Set([
  'Logistics Local Charges Report',
  'Payment Voucher/GL',
  'Bill of Lading',
  'Outward Permit Declaration',
  'Allied Report',
  'CDAS Report',
]);

export const validateDocumentData = (dataList: DocumentData[]): string[] => {
  const allErrors: string[] = [];

  dataList.forEach((data, index) => {
    const prefix = `Doc ${index + 1} (${data.document_type}):`;
    AppConfig.validation.requiredFields.forEach((fieldPath) => {
      // Skip metadata.reference_number for types that use their own ID fields
      if (fieldPath === 'metadata.reference_number' && TYPES_WITHOUT_METADATA_REF.has(data.document_type)) return;
      const value = getNestedValue(data, fieldPath);
      if (!value || (typeof value === "string" && value.trim() === "")) {
        allErrors.push(`${prefix} Missing ${fieldPath}`);
      }
    });
    if (data.metadata?.date && !AppConfig.validation.dateFormat.test(data.metadata.date)) {
      allErrors.push(`${prefix} Invalid date format: ${data.metadata.date}`);
    }
  });

  return allErrors;
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = (error) => reject(error);
  });
};

export const BASE_SYSTEM_PROMPT = `You are a Senior Logistics Data Controller.
The uploaded PDF contains MULTIPLE DISTINCT DOCUMENTS merged into a single file.

YOUR CRITICAL MISSION:
1. **SCAN EVERY SINGLE PAGE**: Do not stop after the first document. The file may contain 10, 20, or 50+ different receipts/invoices.
2. **IDENTIFY BOUNDARIES**: Detect where one document ends and the next begins (e.g., change in Invoice Number, Vendor, or Date).
3. **MERGE RELATED DOCUMENTS**: If you see a Bill of Lading and a Tax Invoice with the SAME Reference Number, MERGE them into a SINGLE 'Logistics Local Charges Report' entry. Do NOT create duplicates.
4. **EXTRACT ALL**: Create a separate entry in the 'documents' list for EACH distinct transaction found.

CLASSIFICATION GUIDELINES:
**CRITICAL**: A Tax Invoice or Freight Invoice that contains a BL number is NOT a "Bill of Lading". The BL number is just a reference field. Classify by the PRIMARY nature of the document:
1. **"Logistics Local Charges Report"**: Any Tax Invoice, Freight Invoice, or Debit Note from a Carrier/Forwarder with logistics charges (THC, Seal Fee, BL Fee, etc.). Even if it references a BL number.
2. **"Payment Voucher/GL"**: Any document requiring payment approval/recording.
3. **"Outward Permit Declaration"**: Singapore Customs Outward Permit.
4. **"Bill of Lading"**: ONLY a standalone Bill of Lading document itself — not an invoice that references one.
5. **"Allied Report"**: An ALLIED Containers report listing container/booking numbers with associated charges (Repair, Detention, DHC In/Out, DHE In/Out, Washing, Data Admin Fee).
6. **"CDAS Report"**: A "TRANSPORTER DAILY TRANSACTION REPORT" — has multiple depot sections (e.g. CHUAN LI CONTAINER, Cogent Container Depot, CWT Tuas, TONG CONTAINERS DEPOT). Each row = one container transaction. Charges are in the "Depot Remark" column as semicolon-separated pairs.

**CRITICAL DUAL-ENTRY RULE — MANDATORY, NO EXCEPTIONS**:
- ANY Tax Invoice, Freight Invoice, Debit Note, or Credit Note from a carrier/forwarder MUST produce TWO entries:
  1. Entry 1: Type = 'Logistics Local Charges Report'. Extract all logistics line items.
  2. Entry 2: Type = 'Payment Voucher/GL'. Extract payment details.
- This applies regardless of what other document types are in the same file (BL, OPD, etc.).
- If you only create ONE entry for an invoice, you are WRONG. Always create BOTH.
- WHY: Ensures the document appears in both Logistics Table AND Accounts Table.

EXTRACTION RULES FOR "Payment Voucher/GL":
- PAYMENT TO ('payment_to'): The company/beneficiary to whom payment is made. Take from the carrier's Tax Invoice letterhead (the issuing company name) or the "Beneficiary Name" on the invoice. Known mappings: MSC → 'MSC MEDITERRANEAN SHIPPING CO SA', ONE → 'OCEAN NETWORK EXPRESS PTE. LTD'. For others, use the full company name as printed.
- PSS INVOICE NUMBER ('pss_invoice_number'): The invoice number stated ON the BL or associated with the BL/PO/Ocean Freight document. It typically appears next to a label like "Invoice:", "Invoice No:", or "Inv:". Format it as "#" followed by the number (e.g., "Invoice: 25091366" → "#25091366"). This number comes from the Invoice, PO, Ocean Freight, or BL document — NOT from the carrier's own invoice number.
- CARRIER INVOICE NUMBER ('carrier_invoice_number'): The invoice number issued by the carrier/forwarder on their tax invoice (e.g., "SGD987.12"). This is a different number from PSS Invoice Number.
- BL NUMBER ('bl_number'): Extract the BL/HBL number if present. Link each carrier invoice to its corresponding BL using the Booking Reference number — both the BL and its Tax Invoice share the same Booking Reference.
- PAYABLE AMOUNT ('payable_amount'): Grand Total with currency (e.g., "250.00 SGD").
- CHARGES SUMMARY ('charges_summary'): List the charge TYPES found in the tax invoice, comma-separated. Use these short forms for known charges: THC (Terminal Handling Charges), BL (BL Fee / Document Fee), SEALS (Seal Fee), O.F (Ocean Freight), ENS, AMS, SBL (Surrender of BL), PRINTED BL. For any OTHER charges not in this list, include them as they appear on the invoice (e.g., "FOOD GRADE", "FUMIGATION", "ISPS"). Example output: "THC, SEALS, BL, SBL, ENS, FOOD GRADE". Only include charges that are actually present in the document.
- MULTI-INVOICE RULE: If a single PDF contains multiple separate Tax Invoices (different invoice numbers, different totals), create a SEPARATE Payment Voucher/GL entry for EACH invoice. Do not merge them into one.

EXTRACTION RULES FOR "Logistics Local Charges Report":
- A. BL NUMBER: Prefer the House BL (HBL) number (e.g., 'EGLV070500202135'). If no HBL exists, use the Master BL (MBL) number instead.
- B. CARRIER / FORWARDER: Look at the LETTERHEAD or ISSUING COMPANY NAME on the invoice, freight note, or BL document — do not rely solely on the BL number. Known mappings: MSC → 'MSC MEDITERRANEAN SHIPPING CO SA', ONE → 'OCEAN NETWORK EXPRESS PTE. LTD'. For all others, extract the FULL COMPANY NAME as printed on the document. If a forwarder issued their invoice using an MBL, use the forwarder name from their invoice letterhead.
- C. PSS INVOICE NUMBER: Invoice number on the BL.
- D. FREIGHT TERM: 'PREPAID' if ocean freight charges exist, else 'COLLECT'.
- E. PLACE OF DESTINATION: Take from the BL field labelled "PLACE OF DELIVERY" or "FINAL DESTINATION". Format MUST be "CITY - COUNTRY" (e.g., FOS SUR MER - FRANCE, AUCKLAND - NEW ZEALAND). For shipments to GUANGZHOU JIAOXIN TERMINAL, use "JiaoXin - China".
- F. CNTR TYPE: Normalize container type codes as follows — output ONLY the standardized form:
  * 20' → for codes: 20GP, 20DC, 20DV, 20FT, 20GB, 20SD, 20ST
  * 20'RF → for codes: 20RF
  * 40' → for codes: 40GP
  * 40HC → for codes: 40HQ, 40H, 40 HIGH CUBE
  * 40RF → for codes: 40RF, 40' refer
  * 40RFHC → for codes: 40HR, 40RH, 40RQ, 4RH, 40 reefer high cube
- G. CONTAINER QTY: From BL or Invoice.
- H. (SGD) THC: Look for T.H.C, THC, Terminal Handling Charge. Extract the PER CONTAINER UNIT charge (not the total). e.g. if 2 containers × $150 each, return "150.00".
- I. (SGD) SEAL FEE: ONLY capture "SLF Seal Fee". Do NOT include "ISL International Seal Fee" or any other seal-related charges — these are NOT local charges and must be ignored entirely. Extract the PER SEAL UNIT charge (not the total). e.g. if 2 seals × $20 each, return "20.00".
- J. (SGD) BL FEE: Bill of Lading / Document Fee.
- K. (SGD) BL PRINTED FEE: Leave blank if none.
- L. (SGD) ENS / AMS / SCMC: ENS Filing, AMS, AFR, SCMC, Cargo Data Declaration total.
- M. (SGD) OTHERS CHARGES: ONLY include these specific charges (sum them if multiple apply): EDI Transmission Fee / Export Service Fee, Certificate Issue Fee, MISC CHARGES, ADDING SEAL, ASR, Interchange Cona, ICS2 Filing, ICS2, UNLOCK BL FEE, CDD CARGO. Take values in SGD only. Do NOT include Surrender Fee or any other charges not listed here.
- N. REMARKS: List the names of charges included in 'Others Charges'.
- O. TOTAL AMOUNT: Extract the grand total payable amount from the invoice (e.g., "838.50"). Number only, no currency symbol.

SPECIAL RULE FOR ONE (OCEAN NETWORK EXPRESS) FREIGHTED BLs:
- When the carrier is ONE and the BL is freighted (has ocean freight charges), ALL charges (THC, Seal Fee, BL Fee, ENS, Others) must be taken from the PREPAID column only.

EXTRACTION RULES FOR "Outward Permit Declaration" (Shipping Team):
- DOCUMENT STRUCTURE: An OPD file typically contains multiple 2-page Shipping Instructions (SI) followed by a B/L Draft summary page. Each SI covers EXACTLY ONE container. Create ONE separate Outward Permit Declaration entry for EACH Shipping Instruction found. Do NOT create a separate entry for the B/L Draft summary page — use it for reference only (e.g. for BL number, carrier). For CONTAINER NO and SEAL NO, look in the "FOR SHIPPING DEPARTMENT ONLY" section at the bottom of page 2 of each SI (labeled "Container / Seal No: CONTAINER / SEAL").
- BL NUMBER: Booking reference / BL number from BL draft or Shipping Instruction (SI). Use the HBL if present, otherwise MBL.
- CARRIER: Carrier/shipping line name from SI or BL draft letterhead.
- CONSIGNEE: Consignee name and address from BL draft or SI.
- CONTAINER NO: Single container number from the "FOR SHIPPING DEPARTMENT ONLY" section of THIS SI's page 2 (e.g. TCKU1234567). One value only — not a list.
- SEAL NO: Single seal number from the "FOR SHIPPING DEPARTMENT ONLY" section of THIS SI's page 2 (e.g. EMCSEC1524). One value only — not a list.
- CTNR TYPE: Container type and count from BL draft or SI (e.g. "1 x 20GP", "2 x 40HC").
- FINAL DESTINATION (PORT CODE): Final destination from SI field "Final Destination" or BL draft field "Place of Delivery". Show the port code if visible (e.g. "BEAU" for Beaufort, "PKMPW" for Port Klang), otherwise show the full port name.
- VESSEL NAME: Vessel name from BL draft or SI.
- VOYAGE: Voyage number from BL draft or SI.
- HS CODE LOOKUP RULE:
  * If the Purchase Order customer is "PSS" OR the document letterhead reads "PULAU SAMBU SINGAPORE":
    Look up the HS code from this reference table by matching the product description:
    COCONUT CREAM/COCONUT MILK → 21069093 (ID)
    CANNED PINEAPPLE → 20082010 (ID)
    COCONUT CREAM POWDER/COCONUT MILK POWDER → 11063000 (ID)
    COCONUT WATER → 20098920 (ID)
    COCONUT MILK DRINK → 22029930 (ID)
    COCONUT WATER CONCENTRATE → 20098930 (ID)
    PINEAPPLE JUICE CONCENTRATE → 20094900 (ID)
    DESICCATED COCONUT → 08011100 (ID)
    REVERSE OSMOSIS WATER / AFTER SAND FILTER WATER → 22019090 (ID)
    COCONUT SHELL CHARCOAL → 44022010 (ID)
    VIRGIN COCONUT OIL → 15131110 (ID)
    OTHER COCONUT OIL → 15131190 (ID)
    T-SHIRT (MEN) POLO → 61099020 (SG)
    CALENDARS → 49100000 (ID)
    FLYERS / WOBBLER / SHELFTALKER → 49111090 (MY)
    STANDEE → 48191000 (SG)
    EMPTY CARTON BOXES → 48191000 (SG)
    POSTER → 49111090 (MY)
    RECIPE BOOKS → 49011000 (MY)
    LEAFLETS → 49111090 (MY)
    BARCODE LABEL / STICKERS → 48119099 (MY)
    BANNER → 49119990 (SG)
    SHIRT → 61059000 (SG)
    NOTE BOOK → 48201000 (ID)
    COCONUT CANDY → 17049099 (ID)
    DRINKING WATER → 22011010 (ID)
  * Otherwise: Extract the HS code directly from the document as provided. Numbers only (e.g. 84137000).
- DESCRIPTION (formatted): From INVOICE item description. Format as: [QTY as whole integer] [UOM] [ITEM DESCRIPTION]. Remove all decimals from quantity (e.g. 1.000 → 1). Example: "1 UNIT CENTRIFUGAL PUMP TYPE: WI+35/35 IN/OUTLET: SMS 76/51 MM". If descriptions across INVOICE, PACKING LIST, BL, and PO do not match, leave this blank.
- NET WEIGHT: Nett Weight Grand Total from PACKING LIST column "Nett Weight (kgs)". Number only, no units.
- VALUE AMOUNT ('item_price_amount'): Total Amount / Extended Price from INVOICE. Number only, no currency. e.g. "1500.00".
- VALUE CURRENCY ('item_price_currency'): Currency code from INVOICE value. e.g. "USD".
- TOTAL OUTER PACK QTY ('total_outer_pack_qty'): Quantity Grand Total from SI or PACKING LIST. Number only. e.g. "250".
- TOTAL OUTER PACK UNIT ('total_outer_pack_unit'): Unit type from SI or PACKING LIST. e.g. "CTNS".
- GROSS WEIGHT AMOUNT ('gross_weight_amount'): Weight Grand Total (gross) from SI or PACKING LIST. Number only. e.g. "3500.00".
- GROSS WEIGHT UNIT ('gross_weight_unit'): Unit from SI or PACKING LIST. e.g. "KGS".
- INVOICE DESCRIPTION (raw): Copy the item description exactly as written in the INVOICE. No formatting.
- PACKING LIST DESCRIPTION (raw): Copy the item description exactly as written in the PACKING LIST. No formatting.
- BL DESCRIPTION (raw): Copy the item description exactly as written in the BILL OF LADING. No formatting.
- PO DESCRIPTION (raw): Copy the item description exactly as written in the PURCHASE ORDER. No formatting.
- DESCRIPTION MATCH: Compare all four raw descriptions above. Do they all refer to the same item? Output "MATCH" or "MISMATCH - [which document differs]". Be strict.
- COUNTRY OF ORIGIN: From PURCHASE ORDER item description field "Product Of Origin". Full country name in capitals e.g. "GERMANY".

EXTRACTION RULES FOR "Allied Report" (Transport Team):
- DOCUMENT STRUCTURE: This is a Receipts Journal. Each row in the summary table is ONE receipt for ONE charge type for ONE container. The SAME container number appears multiple times — once per charge type. The "Customer Type" column tells you the charge type.
- CRITICAL: Read ONLY the summary table (the receipts journal grid at the start). Ignore all individual receipt pages that follow.
- GROUP BY CONTAINER: For each unique Container/Booking No, create ONE Allied Report entry collecting all its charges across all rows.
- EXAMPLE: Container CMAU7642286 appears in rows for "DATA ADMIN FEE (IN)" ($5), "DHE IN" ($4), "DHC IN" ($80), and "REPAIR" ($21.35) — these all merge into ONE entry: dhc_in=80, dhe_in=4, data_admin_fee=5, repair=21.35.
- INVOICE DATE: Extract the date from the "Date" column on the far right of ANY row in the summary table (all rows share the same report date). The format on the document is DD/MM/YYYY HH:MM — convert to YYYY-MM-DD (e.g. "12/11/2025 08:46" → "2025-11-12"). Use this same date for ALL containers extracted from this report. Also set metadata.date to this same value.
- DHC IN: The amount from any row where Customer Type is "DHC IN" for this container (e.g. "80.00"). Null if not present.
- DHC OUT: The amount from any row where Customer Type is "DHC OUT" for this container. Null if not present.
- DHE IN: The amount from any row where Customer Type is "DHE IN" for this container (e.g. "4.00"). Null if not present.
- DHE OUT: The amount from any row where Customer Type is "DHE OUT" for this container. Null if not present.
- DATA ADMIN FEE: The amount from any row where Customer Type is "DATA ADMIN FEE (IN)" or "DATA ADMIN FEE (OUT)" for this container (e.g. "5.00"). Null if not present.
- REPAIR: The amount from any row where Customer Type is "REPAIR" for this container. Null if not present.
- DETENTION: The amount from any row where Customer Type is "DETENTION" for this container. Null if not present.
- WASHING: The amount from any row where Customer Type is "WASHING" for this container. Null if not present.
- DEMURRAGE: The amount from any row where Customer Type is "DEMURRAGE" for this container. Null if not present.

EXTRACTION RULES FOR "CDAS Report" (Transport Team):
- DOCUMENT STRUCTURE: This is a "TRANSPORTER DAILY TRANSACTION REPORT". It has multiple depot sections (e.g. CHUAN LI CONTAINER, Cogent Container Depot, CWT Tuas, TONG CONTAINERS DEPOT). Each section has a transaction table.
- ONE ENTRY PER ROW: Each row in a section table = ONE container. Create ONE CDAS Report entry per row across ALL sections.
- INVOICE DATE: Extract the date from the "Bill Date" column in each row (e.g. "5-Nov-2025"). All rows in the same report share the same Bill Date — use it for every container entry. Convert to YYYY-MM-DD (e.g. "5-Nov-2025" → "2025-11-05"). Also set metadata.date to this same value.
- CONTAINER NUMBER: From the "Container Number" column.
- DEPOT REMARK PARSING: The "Depot Remark" column contains semicolon-separated charge pairs like "CHARGE NAME; $AMOUNT". Parse each pair to fill the correct field:
  - "DHC IN" or "DHC" or "DEPOT HANDLING CHARGE" (no OUT) → dhc_in
  - "DHC OUT" → dhc_out
  - "DHE IN" or "DHE" (no OUT) → dhe_in
  - "DHE OUT" → dhe_out
  - "ADMIN FEE" or "DOC FEE" → data_admin_fee (if both present in same row, use the larger amount)
  - "DETENTION" → detention
  - "REPAIR" or "DAMAGE" → repair
  - "WASHING" or "FB WATER WASHING" or "WATER WASHING" → washing
  - "DEMURRAGE" → demurrage
- Strip the "$" symbol and return numeric strings only (e.g. "75.00" not "$75.00").

IMPORTANT:
- If a value is not found, return null or empty string. Do NOT guess.
- Convert all monetary values to SGD if possible.

Respond ONLY with valid JSON matching this exact structure:
{
  "documents": [
    {
      "document_type": "string (one of: Bill of Lading, Commercial Invoice, Packing List, Purchase Order, Payment Voucher/GL, Container Report, Logistics Local Charges Report, Outward Permit Declaration, Allied Report, CDAS Report, Unknown)",
      "metadata": {
        "reference_number": "string",
        "related_reference_number": "string or null",
        "date": "YYYY-MM-DD",
        "currency": "string or null",
        "incoterms": "string or null",
        "parties": {
          "shipper_supplier": "string or null",
          "consignee_buyer": "string or null",
          "notify_party": "string or null"
        }
      },
      "logistics_details": {
        "vessel_name": "string or null",
        "voyage_number": "string or null",
        "port_of_loading": "string or null",
        "port_of_discharge": "string or null",
        "container_numbers": ["string"],
        "marks_and_numbers": "string or null"
      },
      "financials": {
        "total_amount": "number or null",
        "total_tax_amount": "number or null",
        "line_item_charges": [{"description": "string", "amount": "number"}]
      },
      "cargo_details": {
        "total_gross_weight": "number or null",
        "total_net_weight": "number or null",
        "total_packages": "number or null",
        "weight_unit": "string or null",
        "line_items": [{"description": "string", "quantity": "number", "unit_price": "number", "total": "number", "hs_code": "string"}]
      },
      "payment_voucher_details": {
        "pss_invoice_number": "string or null",
        "carrier_invoice_number": "string or null",
        "bl_number": "string or null",
        "payable_amount": "string or null",
        "total_payable_amount": "string or null",
        "charges_summary": "string or null",
        "payment_to": "string or null — the company name being paid (carrier/forwarder company, e.g. FR. MEYER'S SOHN (FAR EAST) PTE LTD)",
        "payment_method": "string or null — payment method shown on document (e.g. FAST, CHEQUE, CASH, TT)"
      },
      "logistics_local_charges": {
        "bl_number": "string or null",
        "carrier_forwarder": "string or null",
        "pss_invoice_number": "string or null",
        "freight_term": "string or null",
        "place_of_destination": "string or null",
        "container_type": "string or null",
        "container_qty": "string or null",
        "thc_amount": "string or null",
        "seal_fee": "string or null",
        "bl_fee": "string or null",
        "bl_printed_fee": "string or null",
        "ens_ams_fee": "string or null",
        "other_charges": "string or null",
        "remarks": "string or null",
        "total_payable_amount": "string or null"
      },
      "outward_permit_declaration": {
        "permit_number": "string or null",
        "exporter": "string or null",
        "consignee": "string or null",
        "port_of_loading": "string or null",
        "port_of_discharge": "string or null",
        "total_fob_value": "string or null",
        "gst_amount": "string or null",
        "bl_number": "string or null",
        "carrier": "string or null",
        "container_no": "string or null",
        "seal_no": "string or null",
        "container_type": "string or null",
        "final_destination_port": "string or null",
        "vessel_name": "string or null",
        "voyage": "string or null",
        "hs_code": "string or null",
        "description": "string or null",
        "net_weight_kgs": "string or null",
        "item_price_amount": "string or null",
        "item_price_currency": "string or null",
        "total_outer_pack_qty": "string or null",
        "total_outer_pack_unit": "string or null",
        "gross_weight_amount": "string or null",
        "gross_weight_unit": "string or null",
        "invoice_description": "string or null",
        "packing_list_description": "string or null",
        "bl_description": "string or null",
        "po_description": "string or null",
        "description_match": "string or null",
        "country_of_origin": "string or null"
      },
      "allied_report": {
        "container_booking_no": "string or null",
        "invoice_date": "YYYY-MM-DD or null — the Bill Date, Invoice Date, or transaction date printed on the Allied/depot report (convert any format like '25-Oct-2025' to YYYY-MM-DD)",
        "dhc_in": "string or null",
        "dhc_out": "string or null",
        "dhe_in": "string or null",
        "dhe_out": "string or null",
        "data_admin_fee": "string or null",
        "washing": "string or null",
        "repair": "string or null",
        "detention": "string or null",
        "demurrage": "string or null"
      },
      "cdas_report": {
        "container_number": "string or null",
        "invoice_date": "YYYY-MM-DD or null — the Bill Date, Invoice Date, or transaction date printed on the CDAS/depot report (convert any format like '25-Oct-2025' to YYYY-MM-DD)",
        "dhc_in": "string or null",
        "dhc_out": "string or null",
        "dhe_in": "string or null",
        "dhe_out": "string or null",
        "data_admin_fee": "string or null",
        "washing": "string or null",
        "repair": "string or null",
        "detention": "string or null",
        "demurrage": "string or null"
      }
    }
  ]
}`;

// Role-specific extraction scope overrides — appended after the base prompt
const ROLE_SCOPE: Record<string, string> = {
  accounts: `

TEAM SCOPE — ACCOUNTS TEAM (MANDATORY OVERRIDE):
You are extracting for the accounts team. Follow these rules strictly:
CRITICAL: This file may contain MANY Bills of Lading and Tax Invoices (sometimes 5–30+). You MUST scan EVERY page and extract EVERY distinct BL and Tax Invoice — do NOT stop after the first few. Missing entries is a critical error.
1. ONLY extract documents of these types: "Bill of Lading" and "Payment Voucher/GL". All other types must be IGNORED.
2. When you encounter a Tax Invoice, Freight Invoice, Debit Note, or Credit Note from a carrier/forwarder: classify it as "Payment Voucher/GL" ONLY. Do NOT create a "Logistics Local Charges Report" entry for it.
3. OVERRIDE the Merge Rule: Do NOT merge BL + Tax Invoice into a single LCR entry. Keep the BL as "Bill of Lading". Classify the Tax Invoice separately as "Payment Voucher/GL".
4. IGNORE completely: Outward Permit Declarations, Allied Reports, CDAS Reports — do not extract these at all.
5. MULTI-INVOICE: If multiple Tax Invoices exist (different invoice numbers/totals), create a SEPARATE "Payment Voucher/GL" entry for EACH invoice number. All invoices must appear in your output.`,

  logistics: `

TEAM SCOPE — LOGISTICS TEAM (MANDATORY OVERRIDE):
You are extracting for the logistics team. Follow these rules strictly:
1. ONLY extract documents of these types: "Logistics Local Charges Report" and "Outward Permit Declaration". All other types must be IGNORED.
2. When you encounter a Tax Invoice or Freight Invoice: classify it as "Logistics Local Charges Report" ONLY. Do NOT create a "Payment Voucher/GL" entry.
3. IGNORE completely: standalone Bill of Lading pages, Allied Reports, CDAS Reports — do not extract these at all.`,

  transport: `

TEAM SCOPE — TRANSPORT TEAM (MANDATORY OVERRIDE):
You are extracting for the transport team. Follow these rules strictly:
1. ONLY extract documents of these types: "Allied Report" and "CDAS Report". All other types must be IGNORED.
2. IGNORE completely: Bill of Lading, Tax Invoices, Logistics Local Charges Reports, Payment Vouchers, Outward Permit Declarations.`,
};

// Build final prompt with optional user-defined custom instructions and role scope
const buildSystemPrompt = (customInstructions: string[], role?: string): string => {
  let prompt = BASE_SYSTEM_PROMPT;
  if (role && ROLE_SCOPE[role]) prompt += ROLE_SCOPE[role];
  if (customInstructions.length > 0) {
    const rules = customInstructions.map((rule, i) => `${i + 1}. ${rule}`).join("\n");
    prompt += `\n\nADDITIONAL USER-DEFINED EXTRACTION RULES:\n${rules}`;
  }
  return prompt;
};

// For every Logistics Local Charges Report that has no matching Payment Voucher/GL,
// synthesize one so the accounts team always sees their row.
const ensurePaymentVouchers = (docs: DocumentData[]): DocumentData[] => {
  const pvDocs = docs.filter(d => d.document_type === 'Payment Voucher/GL');

  const pvKeys = new Set<string>();
  for (const pv of pvDocs) {
    const inv = pv.payment_voucher_details?.pss_invoice_number?.trim().toUpperCase();
    const bl  = pv.payment_voucher_details?.bl_number?.trim().toUpperCase();
    if (inv) pvKeys.add(`INV_${inv}`);
    if (bl)  pvKeys.add(`BL_${bl}`);
  }

  const synthesized: DocumentData[] = [];
  for (const doc of docs) {
    if (doc.document_type !== 'Logistics Local Charges Report') continue;
    const l = doc.logistics_local_charges;
    // Do NOT skip if l is null — still synthesize a PV using metadata as fallback

    const inv = l?.pss_invoice_number?.trim().toUpperCase();
    const bl  = l?.bl_number?.trim().toUpperCase()
              || doc.metadata?.reference_number?.trim().toUpperCase();

    const alreadyCovered =
      (inv && pvKeys.has(`INV_${inv}`)) ||
      (bl  && pvKeys.has(`BL_${bl}`));
    if (alreadyCovered) continue;

    // Build charges_summary from non-null logistics charge fields
    const chargeMap: [string | null | undefined, string][] = [
      [l?.thc_amount,         'THC'],
      [l?.seal_fee,           'SEALS'],
      [l?.bl_fee,             'BL'],
      [l?.bl_printed_fee,     'PRINTED BL'],
      [l?.ens_ams_fee,        'ENS'],
      [l?.other_charges,      'OTHER'],
    ];
    const charges = chargeMap
      .filter(([val]) => val && val.trim().length > 0)
      .map(([, label]) => label)
      .join(', ');

    const pvEntry: DocumentData = {
      ...doc,
      document_type: 'Payment Voucher/GL',
      logistics_local_charges: undefined,
      payment_voucher_details: {
        pss_invoice_number:     l?.pss_invoice_number   ?? null,
        carrier_invoice_number: null,
        bl_number:              l?.bl_number             ?? doc.metadata?.reference_number ?? null,
        payable_amount:         l?.total_payable_amount  ?? null,
        total_payable_amount:   l?.total_payable_amount  ?? null,
        charges_summary:        charges || null,
        payment_to:             l?.carrier_forwarder     ?? doc.metadata?.parties?.shipper_supplier ?? null,
        payment_method:         null,
      },
    };

    synthesized.push(pvEntry);
    // Register so we don't double-synthesize if multiple LOG entries share same invoice/BL
    if (inv) pvKeys.add(`INV_${inv}`);
    if (bl)  pvKeys.add(`BL_${bl}`);
  }

  return [...docs, ...synthesized];
};

// Helper to remove duplicate documents
const deduplicateDocuments = (docs: DocumentData[]): DocumentData[] => {
  const uniqueDocs = new Map<string, DocumentData>();

  docs.forEach((doc) => {
    if (doc.document_type === "Logistics Local Charges Report" && doc.logistics_local_charges) {
      const l = doc.logistics_local_charges;
      const hasBL = l.bl_number && l.bl_number.length > 1;
      const hasCarrier = l.carrier_forwarder && l.carrier_forwarder.length > 1;
      const hasInvoice = l.pss_invoice_number && l.pss_invoice_number.length > 1;

      const bl = l.bl_number || "UNKNOWN";
      const inv = l.pss_invoice_number || "NO_INV";
      const carrier = l.carrier_forwarder || "NO_CARRIER";

      // If we have nothing to deduplicate on, keep the doc with a unique key
      if (!hasBL && !hasCarrier && !hasInvoice) {
        uniqueDocs.set(`LOG_${Math.random()}`, doc);
        return;
      }

      let key = `LOG_${bl.trim().toUpperCase()}`;
      key += inv !== "NO_INV"
        ? `_${inv.trim().toUpperCase()}`
        : `_${carrier.trim().toUpperCase()}`;

      if (uniqueDocs.has(key)) {
        const existing = uniqueDocs.get(key)!;
        const existingFields = Object.values(existing.logistics_local_charges || {}).filter(
          (v) => v && (v as string).trim().length > 0
        ).length;
        const currentFields = Object.values(l).filter(
          (v) => v && (v as string).trim().length > 0
        ).length;
        if (currentFields > existingFields) uniqueDocs.set(key, doc);
      } else {
        uniqueDocs.set(key, doc);
      }
    } else if (doc.document_type === "Outward Permit Declaration") {
      // Deduplicate OPD entries by container number; discard rows without a valid container (e.g. B/L Draft summary page)
      const containerNo = doc.outward_permit_declaration?.container_no?.trim().toUpperCase();
      const isValidContainer = containerNo && containerNo !== '-' && containerNo.length > 3 && !containerNo.includes(',');
      if (!isValidContainer) return;
      const key = `OPD_${containerNo}`;
      if (!uniqueDocs.has(key)) uniqueDocs.set(key, doc);
    } else if (doc.document_type === 'Allied Report') {
      // Allied/CDAS Reports are deduplicated exclusively by deduplicateByContainer.
      // Using metadata.reference_number here would collapse all containers sharing the same invoice
      // number into one entry, so we let them pass through with unique keys.
      uniqueDocs.set(`ALLIED_${Math.random()}`, doc);
    } else if (doc.document_type === 'CDAS Report') {
      uniqueDocs.set(`CDAS_${Math.random()}`, doc);
    } else {
      let key = "";
      if (doc.payment_voucher_details?.pss_invoice_number) {
        key = `PV_${doc.payment_voucher_details.pss_invoice_number}`;
      } else if (doc.metadata?.reference_number) {
        key = `${doc.document_type}_${doc.metadata.reference_number}`;
      } else {
        key = `DOC_${Math.random()}`;
      }
      if (!uniqueDocs.has(key)) uniqueDocs.set(key, doc);
    }
  });

  return Array.from(uniqueDocs.values());
};

// Split a PDF file into chunks of `chunkSize` pages, returned as base64 strings
const splitPdfIntoChunks = async (file: File, chunkSize = 10): Promise<{ base64: string; pages: string }[]> => {
  const arrayBuffer = await file.arrayBuffer();
  const srcDoc = await PDFDocument.load(arrayBuffer);
  const totalPages = srcDoc.getPageCount();

  if (totalPages <= chunkSize) {
    const base64 = await fileToBase64(file);
    return [{ base64, pages: `1-${totalPages}` }];
  }

  const chunks: { base64: string; pages: string }[] = [];
  for (let start = 0; start < totalPages; start += chunkSize) {
    const end = Math.min(start + chunkSize, totalPages);
    const chunkDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: end - start }, (_, i) => start + i);
    const copiedPages = await chunkDoc.copyPages(srcDoc, pageIndices);
    copiedPages.forEach(p => chunkDoc.addPage(p));
    const bytes = await chunkDoc.save();
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const base64 = btoa(binary);
    chunks.push({ base64, pages: `${start + 1}-${end}` });
  }
  return chunks;
};

// Merges Allied Report and CDAC Report duplicate entries by container number.
// The AI sometimes creates one entry per table row even when the same container
// appears in multiple sections (e.g. IN section + OUT section). This function
// consolidates them deterministically — first non-null value wins per field.
const mergeChargeFields = (dest: any, src: any) => {
  dest.invoice_date   = dest.invoice_date   ?? src.invoice_date;
  dest.dhc_in         = dest.dhc_in         ?? src.dhc_in;
  dest.dhc_out        = dest.dhc_out        ?? src.dhc_out;
  dest.dhe_in         = dest.dhe_in         ?? src.dhe_in;
  dest.dhe_out        = dest.dhe_out        ?? src.dhe_out;
  dest.data_admin_fee = dest.data_admin_fee ?? src.data_admin_fee;
  dest.washing        = dest.washing        ?? src.washing;
  dest.repair         = dest.repair         ?? src.repair;
  dest.detention      = dest.detention      ?? src.detention;
  dest.demurrage      = dest.demurrage      ?? src.demurrage;
};

const deduplicateByContainer = (docs: DocumentData[]): DocumentData[] => {
  const alliedDocs = docs.filter(d => d.document_type === 'Allied Report');
  const cdasDocs   = docs.filter(d => d.document_type === 'CDAS Report');
  const otherDocs  = docs.filter(d => d.document_type !== 'Allied Report' && d.document_type !== 'CDAS Report');
  // Note: CDAC Report has been removed from the system

  const alliedMap = new Map<string, DocumentData>();
  for (const doc of alliedDocs) {
    const key = doc.allied_report?.container_booking_no?.trim().toUpperCase() || `__unknown_${Math.random()}`;
    if (!alliedMap.has(key)) {
      alliedMap.set(key, { ...doc, allied_report: { ...doc.allied_report } });
    } else {
      mergeChargeFields(alliedMap.get(key)!.allied_report!, doc.allied_report || {});
    }
  }

  const cdasMap = new Map<string, DocumentData>();
  for (const doc of cdasDocs) {
    const key = doc.cdas_report?.container_number?.trim().toUpperCase() || `__unknown_${Math.random()}`;
    if (!cdasMap.has(key)) {
      cdasMap.set(key, { ...doc, cdas_report: { ...doc.cdas_report } });
    } else {
      mergeChargeFields(cdasMap.get(key)!.cdas_report!, doc.cdas_report || {});
    }
  }

  return [...otherDocs, ...alliedMap.values(), ...cdasMap.values()];
};

const extractFromChunk = async (
  base64: string,
  systemPrompt: string
): Promise<DocumentData[]> => {
  const client = new Anthropic({
    apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY || "",
    dangerouslyAllowBrowser: true,
  });
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 16000,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: base64 },
              },
              {
                type: "text",
                text: "Extract all documents from this PDF and return valid JSON only. No explanation, no markdown — just the JSON object.",
              },
            ],
          },
        ],
      });
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      if (!text) throw new Error("No data returned from Claude");
      const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      let docs: DocumentData[] = [];
      try {
        const result = JSON.parse(jsonrepair(clean)) as ExtractionResponse;
        docs = result.documents || [];
      } catch {
        // jsonrepair failed — likely a hard truncation mid-token.
        // Extract every completed document object that appears before the cutoff.
        const matches = clean.matchAll(/"document_type"\s*:\s*"([^"]+)"/g);
        const partialDocs: DocumentData[] = [];
        for (const match of matches) {
          // Find the start of the enclosing object for this document_type key
          const keyPos = match.index ?? 0;
          let depth = 0, start = keyPos;
          while (start > 0) {
            start--;
            if (clean[start] === '}') depth++;
            else if (clean[start] === '{') {
              if (depth === 0) break;
              depth--;
            }
          }
          // Try to parse from that opening brace to the next complete closing brace
          let end = keyPos, d = 0;
          for (let i = start; i < clean.length; i++) {
            if (clean[i] === '{') d++;
            else if (clean[i] === '}') { d--; if (d === 0) { end = i; break; } }
          }
          if (end > start) {
            try {
              const obj = JSON.parse(jsonrepair(clean.slice(start, end + 1)));
              if (obj.document_type) partialDocs.push(obj as DocumentData);
            } catch { /* skip unparseable fragment */ }
          }
        }
        docs = partialDocs;
      }
      return deduplicateByContainer(docs);
    } catch (error: any) {
      if (attempt === maxRetries) throw error;
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
    }
  }
  return [];
};

export const extractDocumentData = async (
  file: File,
  customInstructions: string[] = [],
  onProgress?: (stage: string) => void,
  role?: string
): Promise<DocumentData[]> => {
  const systemPrompt = buildSystemPrompt(customInstructions, role);

  // Exponential backoff with jitter — waits only when rate limited, not blindly
  const withBackoff = async (fn: () => Promise<DocumentData[]>, chunkLabel: string): Promise<DocumentData[]> => {
    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const isRateLimit = err?.status === 429 || /rate.limit|too many/i.test(err?.message ?? '');
        if (!isRateLimit || attempt === maxAttempts - 1) throw err;
        // base: 2^attempt seconds (1, 2, 4, 8, 16…) + random jitter up to 1s
        const base = Math.pow(2, attempt) * 1000;
        const jitter = Math.random() * 1000;
        const wait = Math.round((base + jitter) / 1000);
        for (let s = wait; s > 0; s--) {
          onProgress?.(`${chunkLabel} — rate limited, retrying in ${s}s...`);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
    return [];
  };

  onProgress?.('Reading PDF...');
  // Accounts docs can have many BL+Invoice pairs per file — use smaller chunks so
  // each API call has ~3-5 documents rather than 20+, avoiding output token truncation.
  const chunkSize = role === 'accounts' ? 15 : 50;
  const chunks = await splitPdfIntoChunks(file, chunkSize);

  const allDocs: DocumentData[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const label = chunks.length > 1
      ? `Sending to Claude (batch ${i + 1} of ${chunks.length})`
      : 'Sending to Claude';
    onProgress?.(`${label}...`);
    const result = await withBackoff(
      () => extractFromChunk(chunks[i].base64, systemPrompt),
      label
    );
    allDocs.push(...result);
  }

  onProgress?.('Processing results...');
  // ensurePaymentVouchers synthesizes PV entries from LCRs as a fallback.
  // Only relevant for accounts (or no-role fallback) — logistics/transport never need PVs synthesized.
  const withPv = (role === 'logistics' || role === 'transport')
    ? allDocs
    : ensurePaymentVouchers(allDocs);
  return deduplicateByContainer(deduplicateDocuments(withPv));
};
