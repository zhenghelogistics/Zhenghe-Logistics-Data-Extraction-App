import { BASE_SYSTEM_PROMPT } from './base';
import { ACCOUNTS_SYSTEM_PROMPT } from './accounts';
import { LOGISTICS_SYSTEM_PROMPT } from './logistics';

// Role-specific extraction scope overrides — appended after the base prompt (transport only)
const ROLE_SCOPE: Record<string, string> = {

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
