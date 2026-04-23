import { BASE_SYSTEM_PROMPT } from './base';
import { ACCOUNTS_SYSTEM_PROMPT } from './accounts';
import { LOGISTICS_SYSTEM_PROMPT } from './logistics';

// Role-specific extraction scope overrides — appended after the base prompt (not used for accounts/logistics standalone prompts)
const ROLE_SCOPE: Record<string, string> = {

  logistics: `

TEAM SCOPE — LOGISTICS TEAM (MANDATORY OVERRIDE):
You are extracting for the logistics team. Follow these rules strictly:
1. ONLY extract documents of these types: "Logistics Local Charges Report", "Outward Permit Declaration", and "Export Permit Declaration (PSS)". All other types must be IGNORED.
2. When you encounter a Tax Invoice or Freight Invoice: classify it as "Logistics Local Charges Report" ONLY. Do NOT create a "Payment Voucher/GL" entry.
3. When you encounter a bundle containing Purchase Orders, Commercial Invoice, and Packing List for a PSS import shipment (raw materials arriving at PSS factory from Indonesia): classify it as "Export Permit Declaration (PSS)" and extract per the rules above.
4. When you encounter a Proforma Invoice or Delivery Note from an overseas supplier shipped to a Singapore receiver (e.g. Schütz Singapore, any Singapore-addressed consignee): classify it as "Export Permit Declaration (PSS)" and extract per the rules above.
5. IGNORE completely: standalone Bill of Lading pages, Allied Reports, CDAS Reports — do not extract these at all.
6. PULAU SAMBU SINGAPORE (PSG/PSS/RSUP) SHIPPING INSTRUCTIONS — READ CAREFULLY:
   - These are 2-page export Shipping Instructions. Page 1 has customer/order/product info. Page 2 has a "FOR SHIPPING DEPARTMENT ONLY" section with Container No, Seal No, Vessel, Voyage, Booking Ref.
   - Each 2-page SI = ONE "Outward Permit Declaration" entry. Extract container_no and seal_no from the "FOR SHIPPING DEPARTMENT ONLY" section on page 2. Extract vessel, voyage, booking ref, final destination, consignee from page 2 as well.
   - These are EXPORT shipments FROM Singapore — do NOT classify them as "Export Permit Declaration (PSS)".
   - EXCEPTION: If the SI's "Documents Required" field (page 1) contains the text "Export Declaration permit" or "Export Permit", ALSO create a SECOND entry for the same SI as "Export Permit Declaration (PSS)" — extract product description, HS code, quantity, weight, value from page 1 of that SI.
   - Create ONE "Outward Permit Declaration" entry per SI found. Do not skip any SI, even if container/seal fields are blank.`,

  transport: `

TEAM SCOPE — TRANSPORT TEAM (MANDATORY OVERRIDE):
You are extracting for the transport team. Follow these rules strictly:
1. ONLY extract documents of these types: "Allied Report" and "CDAS Report". All other types must be IGNORED.
2. IGNORE completely: Bill of Lading, Tax Invoices, Logistics Local Charges Reports, Payment Vouchers, Outward Permit Declarations.
3. OUTPUT COMPACTLY: For every "CDAS Report" entry, output ONLY these keys — "document_type", "metadata", and "cdas_report". Completely omit "logistics_details", "financials", "cargo_details", "payment_voucher_details", "logistics_local_charges", "outward_permit_declaration", and "allied_report". This saves tokens and allows ALL containers to be extracted.`,
};

// Build final prompt. Accounts and logistics roles get their own lean prompts.
export const buildSystemPrompt = (customInstructions: string[], role?: string): string => {
  let prompt = role === 'accounts' ? ACCOUNTS_SYSTEM_PROMPT : role === 'logistics' ? LOGISTICS_SYSTEM_PROMPT : BASE_SYSTEM_PROMPT;
  if (role && role !== 'accounts' && role !== 'logistics' && ROLE_SCOPE[role]) prompt += ROLE_SCOPE[role];
  if (customInstructions.length > 0) {
    const rules = customInstructions.map((rule, i) => `${i + 1}. ${rule}`).join('\n');
    prompt += `\n\nADDITIONAL USER-DEFINED EXTRACTION RULES:\n${rules}`;
  }
  return prompt;
};
