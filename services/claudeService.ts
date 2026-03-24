import { PDFDocument } from "pdf-lib";
import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import { DocumentData, ExtractionResponse, BLEntry } from "../types";
import { AppConfig } from "../config";

// Helper to access nested properties safely with dot notation
const getNestedValue = (obj: any, path: string) => {
  return path.split(".").reduce((prev, curr) => (prev ? prev[curr] : undefined), obj);
};

// Document types that store their reference in type-specific fields, not metadata.reference_number
// Also used to skip metadata.date validation (these types have their own date fields)
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
      // Skip metadata.reference_number and metadata.date for types that use their own ID/date fields
      if (TYPES_WITHOUT_METADATA_REF.has(data.document_type) &&
          (fieldPath === 'metadata.reference_number' || fieldPath === 'metadata.date')) return;
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
- PAYMENT TO ('payment_to'): The company/beneficiary to whom payment is made. Take from the carrier's Tax Invoice letterhead (the issuing company name) or the "Beneficiary Name" on the invoice. Known mappings: MSC → 'MSC MEDITERRANEAN SHIPPING CO SA', ONE → 'OCEAN NETWORK EXPRESS PTE. LTD', OOCL → 'OOCL (SINGAPORE) PTE LTD'. For others, use the full company name as printed.
- PSS INVOICE NUMBER ('pss_invoice_number'): The invoice number stated ON the BL or associated with the BL/PO/Ocean Freight document. It can appear ANYWHERE on the BL — including inside the Shipper address block, Remarks, or Reference fields — next to a label like "Invoice:", "Invoice No:", "Inv:", or "SI:". Format it as "#" followed by the number (e.g., "Invoice: 25091366" → "#25091366", "INVOICE: 26030371" → "#26030371"). This number comes from the Invoice, PO, Ocean Freight, or BL document — NOT from the carrier's own invoice number. Search the entire document carefully.
- CARRIER INVOICE NUMBER ('carrier_invoice_number'): The invoice number issued by the carrier/forwarder on their tax invoice (e.g., "SGD987.12"). This is a different number from PSS Invoice Number.
- BL NUMBER ('bl_number'): Extract the BL/HBL number if present. Link each carrier invoice to its corresponding BL using the Booking Reference number — both the BL and its Tax Invoice share the same Booking Reference.
- PAYABLE AMOUNT ('payable_amount'): Grand Total with currency (e.g., "250.00 SGD").
- CHARGES SUMMARY ('charges_summary'): List the charge TYPES found in the tax invoice, comma-separated. Use these short forms for known charges: THC (Terminal Handling Charges), BL (BL Fee / Document Fee / O/B DOC FEE / LOCAL BL), SEALS (Seal Fee / HI SEC SEAL CHG / Container Seal Fee / SEAL CHG), O.F (Ocean Freight), ENS, AMS (Advance Manifest / ADV MFST CHGR), SBL (Surrender of BL), PRINTED BL. For any OTHER charges not in this list, include them as they appear on the invoice (e.g., "FOOD GRADE", "FUMIGATION", "ISPS"). Example output: "THC, SEALS, BL, SBL, ENS, FOOD GRADE". Only include charges that are actually present in the document.
- MULTI-INVOICE RULE:
  * If multiple invoices are from DIFFERENT suppliers/carriers (different payment_to), create a SEPARATE Payment Voucher/GL entry for each supplier.
  * If multiple invoices are from the SAME supplier/carrier (same payment_to), merge them into ONE Payment Voucher/GL entry: set carrier_invoice_number to all invoice numbers comma-separated, set total_payable_amount to the combined total, and populate bl_entries as an array — one entry per BL with its bl_number, pss_invoice_number, and individual amount.
  * Example bl_entries: [{"bl_number": "PWTNYC231618", "pss_invoice_number": "#26030346", "amount": "665.98 SGD"}, {"bl_number": "PWTNYC231815", "pss_invoice_number": "#26030351", "amount": "605.35 SGD"}]
  * CRITICAL: Thoroughly review ALL pages and confirm that the PSS invoice number appears on every set of Bills of Lading (BL), without exception. For EVERY bl_entry, you MUST scan the ENTIRE document for its pss_invoice_number — do not leave it null if the number exists anywhere in the document. Each BL line item in a batch invoice often has its own SI/reference number printed next to it (e.g. in a column, in brackets, or in a remarks field). Look for labels like "SI:", "Invoice:", "Inv No:", "Ref:", "PO:" next to each BL row. All entries in the same batch document typically share the same SI number format — if you found it for some entries, look harder for the rest.

EXTRACTION RULES FOR "Logistics Local Charges Report":
- A. BL NUMBER: When the document explicitly labels BOTH an "Ocean Bill of Lading" (or "Master BL" / "MBL") AND a "House Bill of Lading" (or "HBL" / "Shipment No"), always use the Ocean/Master BL number — this means the forwarder is using a Master BL arrangement and the Ocean BL is the primary reference. If only one BL number is present (regardless of label), use that. If the document shows a forwarder-issued HBL without any separate Ocean BL field, use the HBL.
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

// Dedicated system prompt for accounts role — no merge rules, no LCR, no dual-entry rule.
// This replaces BASE_SYSTEM_PROMPT entirely for accounts users.
const ACCOUNTS_SYSTEM_PROMPT = `You are a Senior Accounts Data Controller extracting documents for the accounts team.

YOUR CRITICAL MISSION:
1. SCAN EVERY SINGLE PAGE. Do not stop early. The file may contain 5–30+ Bills of Lading and Tax Invoices.
2. IDENTIFY DOCUMENT BOUNDARIES: Detect where one document ends and the next begins.
3. KEEP DOCUMENTS SEPARATE: A Bill of Lading and a Tax Invoice that share a BL reference number are TWO SEPARATE entries. NEVER merge them.
4. EXTRACT ALL: Create a separate entry for EACH distinct document found.

DOCUMENT TYPES — USE EXACTLY THESE TWO, NOTHING ELSE:
- "Bill of Lading": for the actual BL/HBL/MBL shipping document itself.
- "Payment Voucher/GL": for ANY carrier/forwarder invoice — Tax Invoice, Freight Invoice, Debit Note, Credit Note. These are always "Payment Voucher/GL", never anything else.

DO NOT USE these types — they do not exist for accounts: Logistics Local Charges Report, Outward Permit Declaration, Allied Report, CDAS Report.

CRITICAL RULE — DO NOT SKIP INVOICES: A PDF may contain a BL followed immediately by a carrier Tax Invoice (both about the same shipment). Even though they share the same BL number, they are TWO SEPARATE entries. The Tax Invoice MUST become its own "Payment Voucher/GL" entry. Do NOT treat the invoice as part of the BL. Do NOT skip it because you already extracted the BL. A page showing a carrier letterhead with "INVOICE", charge line items, and "AMOUNT DUE" is always a Tax Invoice → always "Payment Voucher/GL". Customs Permits / Cargo Clearance Permits are the ONLY pages you should ignore for accounts.

EXTRACTION RULES FOR "Payment Voucher/GL":
- PAYMENT TO ('payment_to'): Company name from the carrier's invoice letterhead (the issuing company). Known: MSC → 'MSC MEDITERRANEAN SHIPPING CO SA', ONE → 'OCEAN NETWORK EXPRESS PTE. LTD', OOCL → 'OOCL (SINGAPORE) PTE LTD'. For others, use the full name as printed.
- PSS INVOICE NUMBER ('pss_invoice_number'): The internal PSS invoice number linked to the BL. It can appear ANYWHERE on the BL — including inside the Shipper address block, Remarks, or Reference fields — next to a label like "Invoice:", "Invoice No:", "Inv:", or "SI:". Format: "#" + number (e.g. "INVOICE: 26030371" → "#26030371"). NOT the carrier's own invoice number. Search the entire document.
- CARRIER INVOICE NUMBER ('carrier_invoice_number'): The invoice number issued by the carrier on their tax invoice.
- BL NUMBER ('bl_number'): The BL/HBL number referenced on the invoice.
- PAYABLE AMOUNT ('payable_amount'): Grand total with currency (e.g. "250.00 SGD").
- TOTAL PAYABLE AMOUNT ('total_payable_amount'): Same as payable amount.
- CHARGES SUMMARY ('charges_summary'): Charge types present, comma-separated. Short forms: THC, BL (also O/B DOC FEE / LOCAL BL), SEALS (also HI SEC SEAL CHG / Container Seal Fee / SEAL CHG), O.F (Ocean Freight), ENS, AMS (also ADV MFST CHGR), SBL, PRINTED BL. Include other charges as printed.
- PAYMENT METHOD ('payment_method'): e.g. FAST, CHEQUE, CASH, TT — if shown on document.
- MULTI-INVOICE RULE: CRITICAL — Output exactly ONE separate "Payment Voucher/GL" entry per Tax Invoice number found in the PDF. If you see invoice PWT260300134 and invoice PWT260300201, that is TWO invoices → output TWO entries. Count the distinct invoice numbers and output that exact number of entries. NEVER combine multiple invoice numbers into one entry's carrier_invoice_number field. NEVER sum amounts across invoices. Each entry must have exactly one carrier_invoice_number, one bl_number, one payable_amount.

EXTRACTION RULES FOR "Bill of Lading":
- Extract shipper, consignee, notify party, vessel name, voyage, POL, POD, BL number, container numbers, date.
- Set payment_voucher_details to null for BL entries. Do NOT populate pss_invoice_number on a BL entry — that field belongs only on Payment Voucher/GL entries.

IMPORTANT:
- If a value is not found, return null. Do NOT guess.

Respond ONLY with valid JSON matching this exact structure:
{
  "documents": [
    {
      "document_type": "string (Bill of Lading or Payment Voucher/GL only)",
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
        "line_items": []
      },
      "payment_voucher_details": {
        "pss_invoice_number": "string or null",
        "carrier_invoice_number": "string or null",
        "bl_number": "string or null",
        "payable_amount": "string or null",
        "total_payable_amount": "string or null",
        "charges_summary": "string or null",
        "payment_to": "string or null",
        "payment_method": "string or null",
        "bl_entries": [{"bl_number": "string or null", "pss_invoice_number": "string or null", "amount": "string or null"}]
      },
      "logistics_local_charges": null,
      "outward_permit_declaration": null,
      "allied_report": null,
      "cdas_report": null
    }
  ]
}`;

// Role-specific extraction scope overrides — appended after the base prompt (not used for accounts)
const ROLE_SCOPE: Record<string, string> = {

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

// Build final prompt. Accounts role gets its own clean prompt — no merge/dual-entry rules.
const buildSystemPrompt = (customInstructions: string[], role?: string): string => {
  let prompt = role === 'accounts' ? ACCOUNTS_SYSTEM_PROMPT : BASE_SYSTEM_PROMPT;
  if (role && role !== 'accounts' && ROLE_SCOPE[role]) prompt += ROLE_SCOPE[role];
  if (customInstructions.length > 0) {
    const rules = customInstructions.map((rule, i) => `${i + 1}. ${rule}`).join("\n");
    prompt += `\n\nADDITIONAL USER-DEFINED EXTRACTION RULES:\n${rules}`;
  }
  return prompt;
};

// Hard post-processing for accounts role:
// 1. Convert any LCR that Claude accidentally produced into a PV/GL entry.
// 2. Strip document types that don't belong to accounts (OPD, Allied, CDAS, etc.)
const enforceAccountsLane = (docs: DocumentData[]): DocumentData[] => {
  const allowed = new Set(['Payment Voucher/GL', 'Bill of Lading']);
  const result: DocumentData[] = [];

  for (const doc of docs) {
    if (doc.document_type === 'Logistics Local Charges Report') {
      // Force-convert LCR → PV/GL so it appears in the accounts view
      const l = doc.logistics_local_charges;
      const chargeMap: [string | null | undefined, string][] = [
        [l?.thc_amount,     'THC'],
        [l?.seal_fee,       'SEALS'],
        [l?.bl_fee,         'BL'],
        [l?.bl_printed_fee, 'PRINTED BL'],
        [l?.ens_ams_fee,    'ENS'],
        [l?.other_charges,  'OTHER'],
      ];
      const charges = chargeMap
        .filter(([val]) => val && (val as string).trim().length > 0)
        .map(([, label]) => label)
        .join(', ');

      result.push({
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
      });
    } else if (allowed.has(doc.document_type)) {
      result.push(doc);
    }
    // Everything else (OPD, Allied, CDAS...) is silently dropped for accounts
  }
  return result;
};

// Post-processing merge for accounts role:
// Group all Payment Voucher/GL entries by supplier (payment_to). When multiple invoices
// in the same file come from the same supplier, merge them into one combined PV with
// a bl_entries array and a summed total_payable_amount. This is the definitive rule:
// one PDF = one PV per supplier, always.
const mergeSameSupplierPVs = (docs: DocumentData[]): DocumentData[] => {
  const pvDocs   = docs.filter(d => d.document_type === 'Payment Voucher/GL');
  const otherDocs = docs.filter(d => d.document_type !== 'Payment Voucher/GL');

  // Group by normalised payment_to
  const grouped = new Map<string, DocumentData[]>();
  for (const doc of pvDocs) {
    const key = doc.payment_voucher_details?.payment_to
      ? doc.payment_voucher_details.payment_to.trim().toUpperCase()
      : `__unknown_${Math.random()}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(doc);
  }

  const mergedPVs: DocumentData[] = [];
  for (const group of grouped.values()) {
    if (group.length === 1) {
      mergedPVs.push(group[0]);
      continue;
    }

    // Multiple PVs from the same supplier — collapse into one
    const base = group[0];
    const pv   = base.payment_voucher_details;

    // All carrier invoice numbers, comma-separated
    const allInvNums = group
      .map(d => d.payment_voucher_details?.carrier_invoice_number)
      .filter(Boolean)
      .join(', ');

    // Build bl_entries: one entry per source document
    const blEntries: BLEntry[] = group.map(d => ({
      bl_number:          d.payment_voucher_details?.bl_number          ?? null,
      pss_invoice_number: d.payment_voucher_details?.pss_invoice_number ?? null,
      amount:             d.payment_voucher_details?.payable_amount      ?? null,
    }));

    // Detect currency from any payable_amount string (default SGD)
    const currencyStr = group
      .map(d => d.payment_voucher_details?.payable_amount ?? '')
      .find(s => /USD/i.test(s)) ? 'USD' : 'SGD';

    // Sum numeric totals; keep the raw string if parsing fails
    let totalStr: string | null = null;
    const numericTotal = group.reduce((sum, d) => {
      const raw = d.payment_voucher_details?.payable_amount
                || d.payment_voucher_details?.total_payable_amount
                || '';
      const num = parseFloat(raw.replace(/[^0-9.]/g, ''));
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
    if (numericTotal > 0) {
      totalStr = `${numericTotal.toFixed(2)} ${currencyStr}`;
    }

    // Merge charges_summary: union of all unique charge types
    const allCharges = [
      ...new Set(
        group
          .map(d => d.payment_voucher_details?.charges_summary ?? '')
          .join(',')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      ),
    ].join(', ');

    mergedPVs.push({
      ...base,
      payment_voucher_details: {
        ...pv,
        carrier_invoice_number: allInvNums  || pv?.carrier_invoice_number || null,
        total_payable_amount:   totalStr    ?? pv?.total_payable_amount    ?? null,
        charges_summary:        allCharges  || pv?.charges_summary         || null,
        bl_entries: blEntries,
      },
    });
  }

  return [...otherDocs, ...mergedPVs];
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
      if (doc.document_type === 'Payment Voucher/GL' && doc.payment_voucher_details?.pss_invoice_number) {
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
  systemPrompt: string,
  role?: string
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
                text: role === 'accounts'
                  ? "This PDF may contain Bills of Lading, Tax Invoices/Freight Invoices, AND Customs Permits or Outward Permits. STEP 1: Scan EVERY page. STEP 2: For each Tax Invoice or Freight Invoice page found (carrier letterhead, charge table, Amount Due), output one 'Payment Voucher/GL' entry with that invoice number. STEP 3: For each BL page, output one 'Bill of Lading' entry. STEP 4: Completely ignore Customs Permit / Outward Permit pages. A single PDF with 1 BL + 1 Tax Invoice must produce 2 entries. Do NOT combine invoice numbers. Do NOT sum amounts. Return valid JSON only. No explanation, no markdown."
                  : "Extract all documents from this PDF and return valid JSON only. No explanation, no markdown — just the JSON object.",
              },
            ],
          },
        ],
      });
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      if (!text) throw new Error("No data returned from Claude");
      console.group('%c[ZHL] Claude raw response', 'color:#6366f1;font-weight:bold');
      console.log(text);
      console.groupEnd();
      const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      let docs: DocumentData[] = [];
      try {
        const result = JSON.parse(jsonrepair(clean)) as ExtractionResponse;
        console.group('%c[ZHL] Parsed documents', 'color:#10b981;font-weight:bold');
        result.documents?.forEach((d, i) => {
          console.log(`  [${i}] ${d.document_type} | ref: ${d.metadata?.reference_number} | pss: ${d.payment_voucher_details?.pss_invoice_number} | carrier_inv: ${d.payment_voucher_details?.carrier_invoice_number} | amount: ${d.payment_voucher_details?.total_payable_amount ?? d.payment_voucher_details?.payable_amount}`);
        });
        console.groupEnd();
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
      () => extractFromChunk(chunks[i].base64, systemPrompt, role),
      label
    );
    allDocs.push(...result);
  }

  onProgress?.('Processing results...');

  const logDocs = (label: string, docs: DocumentData[], color: string) => {
    console.group(`%c[ZHL] ${label}`, `color:${color};font-weight:bold`);
    docs.forEach((d, i) => console.log(`  [${i}] ${d.document_type} | ref: ${d.metadata?.reference_number} | pss: ${d.payment_voucher_details?.pss_invoice_number} | amount: ${d.payment_voucher_details?.total_payable_amount ?? d.payment_voucher_details?.payable_amount}`));
    if (!docs.length) console.log('  (empty)');
    console.groupEnd();
  };

  logDocs(`Raw from Claude (${allDocs.length} docs)`, allDocs, '#f59e0b');

  let processed: DocumentData[];
  if (role === 'accounts') {
    processed = enforceAccountsLane(allDocs);
    logDocs(`After enforceAccountsLane (${processed.length} docs)`, processed, '#3b82f6');
    processed = mergeSameSupplierPVs(processed);
    logDocs(`After mergeSameSupplierPVs (${processed.length} docs)`, processed, '#8b5cf6');
  } else if (role === 'logistics' || role === 'transport') {
    processed = allDocs;
  } else {
    processed = ensurePaymentVouchers(allDocs);
  }

  const final = deduplicateByContainer(deduplicateDocuments(processed));
  logDocs(`Final output (${final.length} docs)`, final, '#10b981');
  return final;
};
