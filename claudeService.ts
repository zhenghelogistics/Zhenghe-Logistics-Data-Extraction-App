import { DocumentData, ExtractionResponse } from "../types";
import { AppConfig } from "../config";

// Helper to access nested properties safely with dot notation
const getNestedValue = (obj: any, path: string) => {
  return path.split(".").reduce((prev, curr) => (prev ? prev[curr] : undefined), obj);
};

export const validateDocumentData = (dataList: DocumentData[]): string[] => {
  const allErrors: string[] = [];

  dataList.forEach((data, index) => {
    const prefix = `Doc ${index + 1} (${data.document_type}):`;
    AppConfig.validation.requiredFields.forEach((fieldPath) => {
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
1. **"Logistics Local Charges Report"**: Any Tax Invoice, Freight Invoice, or Debit Note from a Carrier/Forwarder with logistics charges (THC, Seal Fee, etc.).
2. **"Payment Voucher/GL"**: Any document requiring payment.
3. **"Outward Permit Declaration"**: Singapore Customs Outward Permit.
4. **"Transport Job"**: Transport Job Sheet.
5. **"Bill of Lading"**: Standalone Bill of Lading.

**CRITICAL DUAL-ENTRY RULE**:
- If you encounter a Tax Invoice or Freight Invoice:
  1. Entry 1: Type = 'Logistics Local Charges Report'. Extract all logistics line items.
  2. Entry 2: Type = 'Payment Voucher/GL'. Extract payment details.
- WHY: Ensures the document appears in both Logistics Table AND Accounts Table.

EXTRACTION RULES FOR "Payment Voucher/GL":
- INVOICE NUMBER: Map to both 'pss_invoice_number' AND 'carrier_invoice_number'.
- PAYABLE AMOUNT: Grand Total with currency (e.g., "250.00 SGD").
- BL NUMBER: Extract if present.

EXTRACTION RULES FOR "Logistics Local Charges Report":
- A. BL NUMBER: HBL/House Bill of Lading (e.g., 'EGLV070500202135').
- B. CARRIER / FORWARDER: If MSC → 'MSC MEDITERRANEAN SHIPPING CO SA'. If ONE → 'OCEAN NETWORK EXPRESS PTE. LTD'.
- C. PSS INVOICE NUMBER: Invoice number on the BL.
- D. FREIGHT TERM: 'PREPAID' if ocean freight charges exist, else 'COLLECT'.
- E. PLACE OF DESTINATION: Final destination (e.g., AUCKLAND – NEW ZEALAND).
- F. CNTR TYPE: 20', 40', 40HC, 20RF, etc.
- G. CONTAINER QTY: From BL or Invoice.
- H. (SGD) THC: Terminal Handling Charge — PER CONTAINER charge.
- I. (SGD) SEAL FEE: Per seal charge.
- J. (SGD) BL FEE: Bill of Lading / Document Fee.
- K. (SGD) BL PRINTED FEE: Leave blank if none.
- L. (SGD) ENS / AMS / SCMC: ENS Filing, AMS, AFR, SCMC, Cargo Data Declaration total.
- M. (SGD) OTHERS CHARGES: Sum of EDI Fee, Cert Fee, Misc, Adding Seal, ASR, ICS2, CDD. Do NOT include Surrender Fee.
- N. REMARKS: Name of charges included in 'Others'.
- O. TOTAL AMOUNT: Sum of all charges. Must match invoice total.

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
        "gst_amount": "string or null"
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
    if (doc.logistics_local_charges) {
      const l = doc.logistics_local_charges;
      const hasBL = l.bl_number && l.bl_number.length > 1;
      const hasCarrier = l.carrier_forwarder && l.carrier_forwarder.length > 1;
      const hasInvoice = l.pss_invoice_number && l.pss_invoice_number.length > 1;

      if (!hasBL || (!hasCarrier && !hasInvoice)) return;

      const bl = l.bl_number || "UNKNOWN";
      const inv = l.pss_invoice_number || "NO_INV";
      const carrier = l.carrier_forwarder || "NO_CARRIER";

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

export const extractDocumentData = async (
  file: File,
  customInstructions: string[] = []
): Promise<DocumentData[]> => {
  const maxRetries = 3;
  const systemPrompt = buildSystemPrompt(customInstructions);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const base64Data = await fileToBase64(file);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY || "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001", // Fast + cheap for high-volume extraction
          max_tokens: 8000,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: base64Data,
                  },
                },
                {
                  type: "text",
                  text: "Extract all documents from this PDF and return valid JSON only. No explanation, no markdown — just the JSON object.",
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        const isRetryable = response.status === 429 || response.status === 500 || response.status === 503;
        if (attempt === maxRetries || !isRetryable) {
          throw new Error(err.error?.message || `API error ${response.status}`);
        }
        const delay = 2000 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      const data = await response.json();
      const text = data.content?.map((b: any) => b.text || "").join("") || "";

      if (!text) throw new Error("No data returned from Claude");

      // Strip markdown code fences if present
      const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      const result = JSON.parse(clean) as ExtractionResponse;
      return deduplicateDocuments(result.documents || []);

    } catch (error: any) {
      if (attempt === maxRetries) throw error;
      const delay = 2000 * Math.pow(2, attempt - 1);
      console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`, error.message);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return [];
};
