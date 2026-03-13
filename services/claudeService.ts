import { PDFDocument } from "pdf-lib";
import Anthropic from "@anthropic-ai/sdk";
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
  'Transport Job',
  'Bill of Lading',
  'Outward Permit Declaration',
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
4. **"Transport Job"**: Transport Job Sheet.
5. **"Bill of Lading"**: ONLY a standalone Bill of Lading document itself — not an invoice that references one.

**CRITICAL DUAL-ENTRY RULE**:
- If you encounter a Tax Invoice or Freight Invoice:
  1. Entry 1: Type = 'Logistics Local Charges Report'. Extract all logistics line items.
  2. Entry 2: Type = 'Payment Voucher/GL'. Extract payment details.
- WHY: Ensures the document appears in both Logistics Table AND Accounts Table.

EXTRACTION RULES FOR "Payment Voucher/GL":
- PSS INVOICE NUMBER ('pss_invoice_number'): The invoice number stated ON the BL or associated with the BL/PO/Ocean Freight document. It typically appears next to a label like "Invoice:", "Invoice No:", or "Inv:". Format it as "#" followed by the number (e.g., "Invoice: 25091366" → "#25091366"). This number comes from the Invoice, PO, Ocean Freight, or BL document — NOT from the carrier's own invoice number.
- CARRIER INVOICE NUMBER ('carrier_invoice_number'): The invoice number issued by the carrier/forwarder on their tax invoice (e.g., "SGD987.12"). This is a different number from PSS Invoice Number.
- BL NUMBER ('bl_number'): Extract the BL/HBL number if present.
- PAYABLE AMOUNT ('payable_amount'): Grand Total with currency (e.g., "250.00 SGD").
- CHARGES SUMMARY ('charges_summary'): List the charge TYPES found in the tax invoice, comma-separated. Use these short forms for known charges: THC (Terminal Handling Charges), BL (BL Fee / Document Fee), SEALS (Seal Fee), O.F (Ocean Freight), ENS, AMS, SBL (Surrender of BL), PRINTED BL. For any OTHER charges not in this list, include them as they appear on the invoice (e.g., "FOOD GRADE", "FUMIGATION", "ISPS"). Example output: "THC, SEALS, BL, SBL, ENS, FOOD GRADE". Only include charges that are actually present in the document.

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
- VALUE: Total Amount / Extended Price from INVOICE. Include currency symbol. e.g. "1500.00 USD".
- TOTAL OUTER PACK: Quantity Grand Total from SI or PACKING LIST. Number and unit (e.g. "250 CTNS").
- GROSS WEIGHT: Weight Grand Total (gross) from SI or PACKING LIST. Number and unit (e.g. "3500.00 KGS").
- INVOICE DESCRIPTION (raw): Copy the item description exactly as written in the INVOICE. No formatting.
- PACKING LIST DESCRIPTION (raw): Copy the item description exactly as written in the PACKING LIST. No formatting.
- BL DESCRIPTION (raw): Copy the item description exactly as written in the BILL OF LADING. No formatting.
- PO DESCRIPTION (raw): Copy the item description exactly as written in the PURCHASE ORDER. No formatting.
- DESCRIPTION MATCH: Compare all four raw descriptions above. Do they all refer to the same item? Output "MATCH" or "MISMATCH - [which document differs]". Be strict.
- COUNTRY OF ORIGIN: From PURCHASE ORDER item description field "Product Of Origin". Full country name in capitals e.g. "GERMANY".

IMPORTANT:
- If a value is not found, return null or empty string. Do NOT guess.
- Convert all monetary values to SGD if possible.

Respond ONLY with valid JSON matching this exact structure:
{
  "documents": [
    {
      "document_type": "string (one of: Bill of Lading, Commercial Invoice, Packing List, Purchase Order, Payment Voucher/GL, Container Report, Logistics Local Charges Report, Outward Permit Declaration, Transport Job, Unknown)",
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
        "charges_summary": "string or null"
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
        "item_price": "string or null",
        "total_outer_pack": "string or null",
        "gross_weight": "string or null",
        "invoice_description": "string or null",
        "packing_list_description": "string or null",
        "bl_description": "string or null",
        "po_description": "string or null",
        "description_match": "string or null",
        "country_of_origin": "string or null"
      },
      "transport_job": {
        "job_number": "string or null",
        "customer": "string or null",
        "pickup_location": "string or null",
        "delivery_location": "string or null",
        "container_number": "string or null",
        "job_date": "string or null"
      }
    }
  ]
}`;

// Build final prompt with optional user-defined custom instructions
const buildSystemPrompt = (customInstructions: string[]): string => {
  if (customInstructions.length === 0) return BASE_SYSTEM_PROMPT;
  const rules = customInstructions
    .map((rule, i) => `${i + 1}. ${rule}`)
    .join("\n");
  return `${BASE_SYSTEM_PROMPT}\n\nADDITIONAL USER-DEFINED EXTRACTION RULES:\n${rules}`;
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
      // Deduplicate OPD entries by container number
      const containerNo = doc.outward_permit_declaration.container_no?.trim().toUpperCase();
      const isValidContainer = containerNo && containerNo !== '-' && containerNo.length > 3 && !containerNo.includes(',');
      const key = isValidContainer ? `OPD_${containerNo}` : `OPD_${Math.random()}`;
      if (!uniqueDocs.has(key)) uniqueDocs.set(key, doc);
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
        system: systemPrompt,
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
      const result = JSON.parse(clean) as ExtractionResponse;
      return result.documents || [];
    } catch (error: any) {
      if (attempt === maxRetries) throw error;
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
    }
  }
  return [];
};

export const extractDocumentData = async (
  file: File,
  customInstructions: string[] = []
): Promise<DocumentData[]> => {
  const systemPrompt = buildSystemPrompt(customInstructions);
  const chunks = await splitPdfIntoChunks(file, 20);

  // Process chunks one at a time with a delay to avoid rate limits
  const allDocs: DocumentData[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const result = await extractFromChunk(chunks[i].base64, systemPrompt);
    allDocs.push(...result);
    // Wait 30 seconds between chunks to stay within the 30k tokens/min rate limit
    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 30000));
    }
  }

  return deduplicateDocuments(allDocs);
};
