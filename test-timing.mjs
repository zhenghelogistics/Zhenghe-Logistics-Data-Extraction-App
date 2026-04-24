/**
 * Local parse timing test — mirrors the exact production pipeline.
 *
 * Usage:
 *   node test-timing.mjs <path-to-pdf> [role]
 *
 * role: accounts | logistics | transport  (default: logistics)
 *
 * Example:
 *   node test-timing.mjs ~/Downloads/invoice.pdf logistics
 *   node test-timing.mjs ~/Downloads/invoice.pdf accounts
 */

import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

// ─── Args ────────────────────────────────────────────────────────────────────
const pdfPath = process.argv[2];
const role = process.argv[3] || "logistics";

if (!pdfPath) {
  console.error("Usage: node test-timing.mjs <path-to-pdf> [role]");
  console.error("  role: accounts | logistics | transport  (default: logistics)");
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("❌  ANTHROPIC_API_KEY env var not set.");
  console.error("    Run: export ANTHROPIC_API_KEY=sk-ant-...");
  process.exit(1);
}

// ─── Chunk sizes (mirrors claudeService.ts) ──────────────────────────────────
const CHUNK_SIZE = role === "transport" ? 30 : role === "logistics" ? 8 : 15;
const CHUNK_OVERLAP = role === "accounts" ? 3 : role === "logistics" ? 1 : 0;

// ─── Load real system prompts from prompts/*.ts ──────────────────────────────
function loadPrompt(file, varName) {
  const src = readFileSync(resolve(file), "utf8");
  const match = src.match(new RegExp(`${varName}\\s*=\\s*\`([\\s\\S]*?)\`\\s*;?\\s*$`));
  if (!match) throw new Error(`Could not parse ${varName} from ${file}`);
  return match[1];
}

const SYSTEM_PROMPTS = {
  accounts: loadPrompt("prompts/accounts.ts", "ACCOUNTS_SYSTEM_PROMPT"),
  logistics: loadPrompt("prompts/logistics.ts", "LOGISTICS_SYSTEM_PROMPT"),
  transport: loadPrompt("prompts/base.ts", "BASE_SYSTEM_PROMPT"),
};

// ─── User messages — exact match to api/extract.ts ───────────────────────────
const USER_TEXTS = {
  accounts: "This PDF may contain Bills of Lading, Tax Invoices/Freight Invoices, AND Customs Permits or Outward Permits. STEP 1: Scan EVERY page. STEP 2: For each Tax Invoice or Freight Invoice page found (carrier letterhead, charge table, Amount Due), output one 'Payment Voucher/GL' entry with that invoice number. STEP 3: For each BL page, output one 'Bill of Lading' entry. STEP 4: Completely ignore Customs Permit / Outward Permit pages. A single PDF with 1 BL + 1 Tax Invoice must produce 2 entries. Do NOT combine invoice numbers. Do NOT sum amounts. Return valid JSON only. No explanation, no markdown.",
  logistics: "Extract all Shipping Instructions from this PDF. STEP 1: Scan every page — do not stop early. STEP 2: For each SI found — identified by a SHIPPING INSTRUCTION header and a 'FOR SHIPPING DEPARTMENT ONLY' section (which may appear at the bottom of the first page or on a separate second page), regardless of which company or exporter it belongs to — create one entry with document_type 'Outward Permit Declaration'. Put all data inside the outward_permit_declaration object, with container_no and seal_no from that SI's own 'FOR SHIPPING DEPARTMENT ONLY' section. STEP 3: For any SI whose Documents Required field says 'Export Declaration permit' or 'Export Permit', also create a second entry with document_type 'Export Permit Declaration (PSS)' — populate export_permit_pss.items with one item per product line using fields: item_description, hs_code, quantity (integer), uom, amount, currency, po_number, invoice_number. STEP 4: One OPD per SI — do NOT skip any SI regardless of exporter or letterhead. CRITICAL: Use document_type (not type). Return ONLY {\"documents\": [...]}. No markdown.",
  transport: "Extract all Allied Reports and CDAS Reports from this PDF and return valid JSON only. No explanation, no markdown.",
};

// ─── Split PDF into chunks (Node.js version of splitPdfIntoChunks) ────────────
async function splitPdfIntoChunks(pdfBytes, chunkSize, overlap) {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const totalPages = srcDoc.getPageCount();

  console.log(`\n📄 PDF loaded: ${totalPages} pages`);

  if (totalPages <= chunkSize) {
    const base64 = Buffer.from(pdfBytes).toString("base64");
    return [{ base64, pages: `1-${totalPages}` }];
  }

  const chunks = [];
  const stride = Math.max(1, chunkSize - overlap);

  for (let start = 0; start < totalPages; start += stride) {
    const end = Math.min(start + chunkSize, totalPages);
    const chunkDoc = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const copied = await chunkDoc.copyPages(srcDoc, indices);
    copied.forEach((p) => chunkDoc.addPage(p));
    const bytes = await chunkDoc.save();
    const base64 = Buffer.from(bytes).toString("base64");
    chunks.push({ base64, pages: `${start + 1}-${end}` });
    if (end >= totalPages) break;
  }

  return chunks;
}

// ─── Format ms → human readable ──────────────────────────────────────────────
function fmt(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  if (ms < 60000) return `${s}s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(1);
  return `${mins}m ${secs}s`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const systemPrompt = SYSTEM_PROMPTS[role] || SYSTEM_PROMPTS.logistics;
  const userText = USER_TEXTS[role] || USER_TEXTS.logistics;

  console.log("═══════════════════════════════════════════════════");
  console.log("  Pluckd Local Parse Timing Test");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  PDF   : ${resolve(pdfPath)}`);
  console.log(`  Role  : ${role}`);
  console.log(`  Chunks: ${CHUNK_SIZE} pages each${CHUNK_OVERLAP > 0 ? ` (${CHUNK_OVERLAP}-page overlap)` : ""}`);
  console.log(`  Model : claude-sonnet-4-6`);
  console.log("═══════════════════════════════════════════════════");

  // Read PDF
  let pdfBytes;
  try {
    pdfBytes = readFileSync(resolve(pdfPath));
  } catch (e) {
    console.error(`❌  Cannot read file: ${pdfPath}`);
    process.exit(1);
  }

  // Split into chunks
  const chunks = await splitPdfIntoChunks(pdfBytes, CHUNK_SIZE, CHUNK_OVERLAP);
  console.log(`  Split into ${chunks.length} chunk(s)\n`);

  const VERCEL_TIMEOUT_MS = 300_000; // Vercel Pro limit
  const overallStart = Date.now();

  console.log(`  🚀 Running all ${chunks.length} chunks IN PARALLEL...\n`);

  // Process all chunks simultaneously
  const chunkTimings = await Promise.all(
    chunks.map(async (chunk, i) => {
      const { base64, pages } = chunk;
      const label = `Chunk ${i + 1}/${chunks.length} (pages ${pages})`;
      console.log(`⏳ ${label} started`);
      const chunkStart = Date.now();

      try {
        const stream = client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 32000,
          system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
          messages: [
            {
              role: "user",
              content: [
                { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
                { type: "text", text: userText },
              ],
            },
          ],
        });

        const response = await stream.finalMessage();
        const elapsed = Date.now() - chunkStart;
        const usage = response.usage;
        const tokenInfo = `in=${usage.input_tokens} out=${usage.output_tokens}`;
        const timeoutWarning = elapsed > VERCEL_TIMEOUT_MS ? " ⚠️  WOULD TIMEOUT ON VERCEL PRO!" : "";
        const rawText = response.content[0].type === "text" ? response.content[0].text : "";
        console.log(`✅  ${label} done — ${fmt(elapsed)}  [${tokenInfo}]${timeoutWarning}`);
        return { label, elapsed, status: "ok", tokenInfo, rawText };
      } catch (err) {
        const elapsed = Date.now() - chunkStart;
        console.log(`❌  ${label} ERROR after ${fmt(elapsed)} — ${err.message}`);
        return { label, elapsed, status: "error", tokenInfo: err.message };
      }
    })
  );

  const totalElapsed = Date.now() - overallStart;

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  TIMING SUMMARY");
  console.log("═══════════════════════════════════════════════════");

  chunkTimings.forEach(({ label, elapsed, status, tokenInfo }) => {
    const icon = status === "ok" ? "✅" : "❌";
    const warn = elapsed > VERCEL_TIMEOUT_MS ? " ⚠️ TIMEOUT" : "";
    console.log(`  ${icon} ${label.padEnd(30)} ${fmt(elapsed).padStart(8)}  [${tokenInfo}]${warn}`);
  });

  console.log("───────────────────────────────────────────────────");
  console.log(`  Total wall-clock time: ${fmt(totalElapsed)}`);
  console.log(`  Vercel Pro max per chunk : 300s (5 min)`);
  console.log(`  Parallel speedup         : chunks ran simultaneously`);

  const wouldTimeout = chunkTimings.some((c) => c.elapsed > VERCEL_TIMEOUT_MS);
  const slowestChunk = Math.max(...chunkTimings.map((c) => c.elapsed));
  if (wouldTimeout) {
    console.log("\n  ⚠️  VERDICT: One or more chunks EXCEED 5 min → even Vercel Pro would timeout.");
    console.log("     Need smaller chunks or compact output instructions.");
  } else {
    console.log(`\n  ✅  VERDICT: All chunks under 5 min — safe on Vercel Pro.`);
    console.log(`     Wall-clock time with parallel: ${fmt(slowestChunk)} (slowest chunk)`);
    console.log(`     vs sequential would have been: ${fmt(chunkTimings.reduce((a, c) => a + c.elapsed, 0))}`);
  }

  console.log("═══════════════════════════════════════════════════\n");

  // Save raw JSON output for inspection
  const outputPath = resolve("test-output.json");
  const allOutput = chunkTimings
    .filter((c) => c.status === "ok" && c.rawText)
    .map((c) => ({ chunk: c.label, raw: c.rawText }));
  writeFileSync(outputPath, JSON.stringify(allOutput, null, 2));
  console.log(`💾  Raw output saved to: ${outputPath}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
