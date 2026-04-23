import { PDFDocument } from "pdf-lib";
import { jsonrepair } from "jsonrepair";
import { DocumentData, ExtractionResponse, BLEntry } from "../types";
import { AppConfig } from "../config";
import { BASE_SYSTEM_PROMPT } from "../prompts/base";
import { buildSystemPrompt } from "../prompts/buildPrompt";

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
  'Export Permit Declaration (PSS)',
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

export type ExtractionErrorCode =
  | 'ERR-RATE-LIMIT'
  | 'ERR-AUTH'
  | 'ERR-API-500'
  | 'ERR-API-UNKNOWN'
  | 'ERR-NO-RESPONSE'
  | 'ERR-JSON-PARSE'
  | 'ERR-PDF-READ'
  | 'ERR-TIMEOUT';

export class ExtractionError extends Error {
  code: ExtractionErrorCode;
  stage?: string;
  constructor(code: ExtractionErrorCode, detail: string, stage?: string) {
    super(`[${code}] ${detail}${stage ? ` (at: ${stage})` : ''}`);
    this.name = 'ExtractionError';
    this.code = code;
    this.stage = stage;
  }
}

const makeError = (code: ExtractionErrorCode, detail: string, stage?: string): ExtractionError =>
  new ExtractionError(code, detail, stage);

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

export { BASE_SYSTEM_PROMPT };

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
export const mergeSameSupplierPVs = (docs: DocumentData[]): DocumentData[] => {
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

    // Build bl_entries: expand existing bl_entries arrays first, fall back to top-level fields
    const rawEntries: BLEntry[] = group.flatMap(d => {
      const pv = d.payment_voucher_details;
      if (pv?.bl_entries && pv.bl_entries.length > 0) return pv.bl_entries;
      return [{ bl_number: pv?.bl_number ?? null, pss_invoice_number: pv?.pss_invoice_number ?? null, amount: pv?.payable_amount ?? null }];
    });
    // Deduplicate by BL number, merging to keep the best available data per field
    const blMap = new Map<string, BLEntry>();
    for (const entry of rawEntries) {
      const key = entry.bl_number?.trim().toUpperCase() || `__no_bl_${blMap.size}`;
      if (blMap.has(key)) {
        const existing = blMap.get(key)!;
        blMap.set(key, {
          bl_number:          existing.bl_number          || entry.bl_number,
          pss_invoice_number: existing.pss_invoice_number || entry.pss_invoice_number,
          amount:             existing.amount             || entry.amount,
        });
      } else {
        blMap.set(key, entry);
      }
    }
    const blEntries: BLEntry[] = Array.from(blMap.values());

    // Detect currency from any amount string (default SGD)
    const currencyStr = group
      .map(d => d.payment_voucher_details?.payable_amount ?? '')
      .find(s => /USD/i.test(s)) ? 'USD' : 'SGD';

    // Sum from bl_entries amounts (most accurate after dedup); fall back to group totals
    let totalStr: string | null = null;
    const entryTotal = blEntries.reduce((sum, e) => {
      const num = parseFloat((e.amount || '').replace(/[^0-9.]/g, ''));
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
    if (entryTotal > 0) {
      totalStr = `${entryTotal.toFixed(2)} ${currencyStr}`;
    } else {
      // Fall back: use total_payable_amount from whichever chunk has it
      const rawTotal = group.map(d => d.payment_voucher_details?.total_payable_amount).find(Boolean) || null;
      totalStr = rawTotal ?? null;
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

// Remove OPD ghost rows and orphan pre-entries.
// A null-container OPD is an orphan pre-entry if it has NO consignee — real SIs
// (including pending bookings and RSUP multi-shipper entries) always have a
// named consignee. Rows with no consignee are either BL Draft artifacts or
// pre-entry stubs with no attribution.
const removeOrphanOPDs = (docs: DocumentData[]): DocumentData[] => {
  const opds  = docs.filter(d => d.document_type === 'Outward Permit Declaration');
  const other = docs.filter(d => d.document_type !== 'Outward Permit Declaration');

  const filtered = opds.filter(doc => {
    const opd = doc.outward_permit_declaration;
    const containerNo = opd?.container_no?.trim().toUpperCase() ?? '';
    const isValid = containerNo && containerNo !== '-' && containerNo.length > 3 && !containerNo.includes(',');
    if (isValid) return true; // Always keep container-confirmed entries

    const consignee = (opd?.consignee ?? '').trim();

    // Drop: null-container OPDs with no consignee — these are pre-entry stubs
    // or BL Draft artifacts, never a real SI. RSUP multi-shipper entries and
    // pending bookings always have a consignee populated.
    if (!consignee) return false;

    return true;
  });

  return [...other, ...filtered];
};

// For multi-shipper containers: RSUP SIs share container/seal with their PSG
// counterpart. If an OPD entry has correct product data but null container/seal,
// propagate from a sibling entry with the same BL number (first pass) or same
// consignee prefix (fallback). Safe: only fills null fields, never overwrites.
const propagateContainerToRSUP = (docs: DocumentData[]): DocumentData[] => {
  const opds  = docs.filter(d => d.document_type === 'Outward Permit Declaration');
  const other = docs.filter(d => d.document_type !== 'Outward Permit Declaration');

  type ContainerData = { container_no: string; seal_no: string | null; container_type: string | null };

  const blMap       = new Map<string, ContainerData>();
  const consigneeMap = new Map<string, ContainerData>();

  for (const doc of opds) {
    const opd = doc.outward_permit_declaration;
    const containerNo = opd?.container_no?.trim().toUpperCase() ?? '';
    const isValid = containerNo && containerNo !== '-' && containerNo.length > 3 && !containerNo.includes(',');
    if (!isValid) continue;

    const data: ContainerData = {
      container_no:   opd!.container_no!,
      seal_no:        opd!.seal_no        ?? null,
      container_type: opd!.container_type ?? null,
    };

    const bl = (opd!.bl_number ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (bl.length >= 4) blMap.set(bl, data);

    const consigneeKey = (opd!.consignee ?? '').trim().toUpperCase().substring(0, 30);
    if (consigneeKey.length >= 5) consigneeMap.set(consigneeKey, data);
  }

  const patched = opds.map(doc => {
    const opd = doc.outward_permit_declaration;
    if (!opd) return doc;
    const containerNo = opd.container_no?.trim().toUpperCase() ?? '';
    const isValid = containerNo && containerNo !== '-' && containerNo.length > 3 && !containerNo.includes(',');
    if (isValid) return doc; // Already has container

    let source: ContainerData | undefined;

    // Try BL match first
    const bl = (opd.bl_number ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (bl.length >= 4) source = blMap.get(bl);

    // Fallback: consignee match
    if (!source) {
      const consigneeKey = (opd.consignee ?? '').trim().toUpperCase().substring(0, 30);
      if (consigneeKey.length >= 5) source = consigneeMap.get(consigneeKey);
    }

    if (!source) return doc;

    return {
      ...doc,
      outward_permit_declaration: {
        ...opd,
        container_no:   opd.container_no   || source.container_no,
        seal_no:        opd.seal_no        || source.seal_no,
        container_type: opd.container_type || source.container_type,
      },
    };
  });

  return [...other, ...patched];
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
      const opd = doc.outward_permit_declaration;
      const containerNo = opd?.container_no?.trim().toUpperCase();
      // Multi-shipper containers: two SIs (different exporters) legitimately share the same
      // container number. Include a normalised exporter in the key so both entries survive.
      // Without a valid container, keep every entry unconditionally (random key).
      const isValidContainer = containerNo && containerNo !== '-' && containerNo.length > 3 && !containerNo.includes(',');
      const exporter = (opd?.exporter ?? '').trim().toUpperCase().replace(/\s+/g, '_');
      const key = isValidContainer
        ? `OPD_${containerNo}_${exporter || 'UNKNOWN'}`
        : `OPD_${Math.random()}`;
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

// Split a PDF file into chunks of `chunkSize` pages, returned as base64 strings.
// For accounts role (overlap > 0): each chunk overlaps the previous by `overlap` pages
// so that BL/invoice sets that span a chunk boundary appear in full in at least one chunk.
const splitPdfIntoChunks = async (file: File, chunkSize = 10, overlap = 0): Promise<{ base64: string; pages: string }[]> => {
  const arrayBuffer = await file.arrayBuffer();
  const srcDoc = await PDFDocument.load(arrayBuffer);
  const totalPages = srcDoc.getPageCount();

  if (totalPages <= chunkSize) {
    const base64 = await fileToBase64(file);
    return [{ base64, pages: `1-${totalPages}` }];
  }

  const chunks: { base64: string; pages: string }[] = [];
  const stride = Math.max(1, chunkSize - overlap);
  for (let start = 0; start < totalPages; start += stride) {
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
    // Stop once the last page is covered
    if (end >= totalPages) break;
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

export const deduplicateByContainer = (docs: DocumentData[]): DocumentData[] => {
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
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const apiRes = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, systemPrompt, role }),
      });
      if (!apiRes.ok) {
        const err = await apiRes.json().catch(() => ({ error: `HTTP ${apiRes.status}` }));
        const status = apiRes.status;
        if (status === 429) throw makeError('ERR-RATE-LIMIT', `Rate limited (HTTP 429)`);
        if (status === 401 || status === 403) throw makeError('ERR-AUTH', `Authentication failed (HTTP ${status})`);
        if (status === 504) throw makeError('ERR-TIMEOUT', `Gateway timeout — PDF chunk too large or Claude took too long (HTTP 504)`);
        if (status >= 500) throw makeError('ERR-API-500', err.error || `Server error (HTTP ${status})`);
        throw makeError('ERR-API-UNKNOWN', err.error || `HTTP ${status}`);
      }
      const { text } = await apiRes.json();
      if (!text) throw makeError('ERR-NO-RESPONSE', 'Claude returned an empty response');
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
        console.warn(`[ZHL] partial recovery triggered — ${partialDocs.length} doc(s) salvaged from truncated Claude response`);
      }
      return deduplicateByContainer(docs);
    } catch (error: any) {
      if (attempt === maxRetries) {
        if (!(error as any).code) {
          if (error?.name === 'AbortError' || error?.message?.includes('timeout')) throw makeError('ERR-TIMEOUT', 'Request timed out');
          throw makeError('ERR-API-UNKNOWN', error?.message || 'Unknown API error');
        }
        throw error;
      }
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
    }
  }
  return [];
};

// After the main extraction + merge, some bl_entries may still have null
// pss_invoice_number because the text appeared in a different chunk.
// This sends ONE targeted Claude query over the full file asking specifically
// for the missing PSS numbers, then patches the results.
const enrichMissingPSSNumbers = async (
  docs: DocumentData[],
  file: File,
  onProgress?: (stage: string) => void,
): Promise<DocumentData[]> => {
  type Missing = { bl_number: string; carrier_invoice_number: string };
  const missing: Missing[] = [];

  for (const doc of docs) {
    if (doc.document_type !== 'Payment Voucher/GL') continue;
    const entries = doc.payment_voucher_details?.bl_entries ?? [];
    const carrierParts = (doc.payment_voucher_details?.carrier_invoice_number ?? '').split(',').map(s => s.trim());
    entries.forEach((entry, i) => {
      if (!entry.pss_invoice_number && entry.bl_number) {
        missing.push({ bl_number: entry.bl_number, carrier_invoice_number: carrierParts[i] || carrierParts[0] || '' });
      }
    });
  }

  if (missing.length === 0) return docs;

  onProgress?.('Filling in missing PSS numbers...');
  console.log(`[ZHL] enrichMissingPSSNumbers: querying for ${missing.length} BL(s):`, missing.map(m => m.bl_number).join(', '));

  try {
    const base64 = await fileToBase64(file);

    const listLines = missing.map(m =>
      `- BL ${m.bl_number}${m.carrier_invoice_number ? ` (carrier invoice ${m.carrier_invoice_number})` : ''}`
    ).join('\n');

    const apiRes = await fetch('/api/enrichPSS', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, listLines }),
    });
    if (!apiRes.ok) throw new Error(`HTTP ${apiRes.status}`);
    const { text: raw } = await apiRes.json();
    const pssMap: Record<string, string | null> = JSON.parse(jsonrepair(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()));
    console.log('[ZHL] enrichMissingPSSNumbers result:', pssMap);

    return docs.map(doc => {
      if (doc.document_type !== 'Payment Voucher/GL') return doc;
      const entries = doc.payment_voucher_details?.bl_entries;
      if (!entries) return doc;
      let changed = false;
      const patched: BLEntry[] = entries.map(entry => {
        if (entry.pss_invoice_number || !entry.bl_number) return entry;
        const found = pssMap[entry.bl_number] ?? pssMap[entry.bl_number.trim().toUpperCase()] ?? null;
        if (!found) return entry;
        changed = true;
        return { ...entry, pss_invoice_number: found };
      });
      return changed ? { ...doc, payment_voucher_details: { ...doc.payment_voucher_details, bl_entries: patched } } : doc;
    });
  } catch (err) {
    console.warn('[ZHL] enrichMissingPSSNumbers failed — returning docs unchanged', err);
    return docs;
  }
};

export const extractDocumentData = async (
  file: File,
  customInstructions: string[] = [],
  onProgress?: (stage: string, progress?: number) => void,
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
        if (!isRateLimit || attempt === maxAttempts - 1) {
          // Annotate with stage if not already a coded error
          if (!(err as any).code) {
            throw makeError('ERR-RATE-LIMIT', `Rate limited after ${attempt + 1} attempt(s)`, chunkLabel);
          }
          // Re-wrap with stage context
          const staged = makeError((err as any).code, err.message.replace(/^\[ERR-[A-Z-]+\]\s*/, ''), chunkLabel);
          throw staged;
        }
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
  const chunkSize = role === 'transport' ? 30 : role === 'logistics' ? 6 : 15;
  // accounts: 3-page overlap so BLs that straddle chunk boundaries appear in full in at least one chunk
  // logistics: 0 overlap — SIs are exactly 2 pages, so 6-page chunk boundaries always fall
  //            between SIs (pages 6→7, 12→13…), never inside one. Overlap causes duplicates.
  const chunkOverlap = role === 'accounts' ? 3 : 0;
  let chunks: Awaited<ReturnType<typeof splitPdfIntoChunks>>;
  try {
    chunks = await splitPdfIntoChunks(file, chunkSize, chunkOverlap);
  } catch (err: any) {
    throw makeError('ERR-PDF-READ', `Could not read or chunk the PDF: ${err?.message || 'unknown'}`, 'Reading PDF');
  }

  const totalChunks = chunks.length;
  onProgress?.(totalChunks > 1 ? `Analysing 0 of ${totalChunks} batches…` : 'Sending to Claude…', 0);

  let doneChunks = 0;
  const chunkSettled = await Promise.allSettled(
    chunks.map((chunk, i) => {
      const label = totalChunks > 1 ? `batch ${i + 1} of ${totalChunks}` : 'Sending to Claude';
      return withBackoff(() => extractFromChunk(chunk.base64, systemPrompt, role), label).then(result => {
        doneChunks++;
        const pct = Math.round((doneChunks / totalChunks) * 90); // reserve last 10% for post-processing
        onProgress?.(`Analysing ${doneChunks} of ${totalChunks} batch${totalChunks > 1 ? 'es' : ''}…`, pct);
        return result;
      });
    })
  );

  // Collect successful chunks — don't let one bad chunk discard everyone else's results
  const allDocs: DocumentData[] = chunkSettled.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const failedChunks = chunkSettled.filter(r => r.status === 'rejected');
  if (failedChunks.length > 0 && allDocs.length === 0) {
    // All chunks failed — surface the first error
    throw (failedChunks[0] as PromiseRejectedResult).reason;
  }

  onProgress?.('Processing results…', 95);

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
    processed = await enrichMissingPSSNumbers(processed, file, onProgress);
    logDocs(`After enrichMissingPSSNumbers (${processed.length} docs)`, processed, '#f43f5e');
  } else if (role === 'logistics') {
    processed = removeOrphanOPDs(allDocs);
    logDocs(`After removeOrphanOPDs (${processed.length} docs)`, processed, '#ec4899');
    processed = propagateContainerToRSUP(processed);
    logDocs(`After propagateContainerToRSUP (${processed.length} docs)`, processed, '#f97316');
  } else if (role === 'transport') {
    processed = allDocs;
  } else {
    processed = ensurePaymentVouchers(allDocs);
  }

  const final = deduplicateByContainer(deduplicateDocuments(processed));
  logDocs(`Final output (${final.length} docs)`, final, '#10b981');
  return final;
};
