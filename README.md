# Pluckd — Logistics Document Extraction App

> Built by Zhenghe Logistics. Entirely designed, architected, and written by [Claude](https://claude.ai) (Anthropic).

Pluckd is an internal AI-powered document extraction tool that processes logistics PDFs and exports structured data as CSV. It uses Claude (claude-sonnet) to read and extract data from complex, multi-format shipping documents — no OCR, no templates, no manual entry.

---

## How It Works

1. Upload one or more PDF files (drag & drop or file picker)
2. Claude reads each document and extracts structured data
3. Results appear in a filterable table, organised by document type
4. Export individual CSVs per document type, or download everything as a ZIP

PDFs are chunked client-side using `pdf-lib` and sent to Claude via the Anthropic browser SDK. All processing happens in the browser — no backend server.

---

## Document Types

### Accounts Team
| Type | Description |
|---|---|
| **Payment Voucher / GL** | Extracts PSS invoice number, carrier/forwarder invoice number, BL number, payable amount, total payable, and itemised charges |

### Shipping Department (Logistics)
| Type | Description |
|---|---|
| **Logistics Local Charges Report** | BL number, carrier/forwarder, PSS invoice number, freight term, destination, container type/qty, and all SGD charges (THC, seal fee, BL fee, ENS/AMS/SCMC, others, total) |
| **Outward Permit Declaration** | BL, carrier, consignee, container, seal, vessel/voyage, HS code, description, net weight, value, currency, pack qty/unit, gross weight |
| **Export Permit Declaration (PSS)** | Line-item extraction: HS code, qty, UOM, item description, product of origin, nett weight, amount, currency, PO number, invoice number — supports both PSS/RSUP shipments (USD, Argus Wuhan) and Schutz-format proforma invoices (EUR, `Comm.code.no.` HS codes, COO from country code) |

### Transport Team
| Type | Description |
|---|---|
| **Allied Report** | Container/booking number, DHC in/out, DHE in/out, data admin fee, washing, repair, detention, demurrage |
| **CDAS Report** | Same charge categories as Allied, keyed by container number |
| **CRM Billing** | Container billing management with charge validation, billing status tracking, and archive support |

---

## Features

- **Role-based access** — Three teams (Accounts, Shipping Department, Transport) each see only their relevant document types and tabs
- **Drag & drop uploads** — Drop multiple PDFs at once; each is queued and processed in parallel
- **Re-process button** — Re-run extraction on any already-processed file without re-uploading
- **ZIP export** — Download all extracted CSVs and a processing log in one zip file, with each document type as its own CSV
- **Custom extraction rules** — Freeform rules panel that injects additional instructions into Claude's extraction prompt (persisted in localStorage)
- **CRM Billing tab** — Full billing lifecycle: import container charges from Allied/CDAS reports, validate charges, mark as billed, archive records
- **Voucher PDF generation** — Generate formatted payment voucher PDFs for Allied and CDAS reports directly from the UI
- **Auto update detection** — Polls for new deployments every 10 minutes; shows a banner prompting users to refresh when a new version is live
- **Admin role switcher** — Admin users can toggle between all three team roles from the sidebar for testing
- **Supabase persistence** — Extracted documents are saved to Supabase and reloaded on next session; no data loss on refresh

---

## Tech Stack

- **React + TypeScript** — UI and state
- **Vite** — Build tooling
- **Tailwind CSS v3** — Styling (PostCSS build plugin, not CDN)
- **Anthropic browser SDK** — Claude API calls directly from the browser
- **pdf-lib** — PDF chunking for large documents
- **jsonrepair** — Tolerant JSON parsing for Claude responses
- **JSZip** — Client-side ZIP generation
- **Supabase** — Auth, document storage, CRM billing records
- **pdf-lib + jsPDF** — Voucher PDF generation

---

## Running Locally

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.local.example` to `.env.local` and fill in:
   ```
   VITE_ANTHROPIC_API_KEY=your_key_here
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

3. Run the dev server:
   ```bash
   npm run dev
   ```

---

## Changelog

| Version | Change |
|---|---|
| Latest | PSS in ZIP export + re-process button |
| — | Schutz-format Proforma Invoice extraction for Export Permit PSS |
| — | Remove Templates feature (replaced by hardcoded document types) |
| — | Export Permit Declaration (PSS) tab for Shipping Department |
| — | Fuel surcharge merged into DHC for Allied and CDAS extraction |
| — | Mass delete for CRM billing tab |
| — | Streaming API for 32k token extractions |
| — | Deep Ledger design system (Manrope font, `#091426` primary, `#00668a` secondary) |
| — | Allied + CDAS voucher PDF generation |
| — | CRM Billing tab with charge validation and archive |
