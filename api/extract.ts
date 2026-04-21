import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

// Vercel serverless function — API key stays server-side, never exposed to browser
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body: any;
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { base64, systemPrompt, role, userText } = body;
  if (!base64 || !systemPrompt) {
    res.status(400).json({ error: "Missing required fields: base64, systemPrompt" });
    return;
  }

  if (base64.length > 20_000_000) {
    res.status(413).json({ error: "File too large — max ~15MB PDF supported" });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in environment variables" });
    return;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const resolvedUserText = userText ?? (
    role === "accounts"
      ? "This PDF may contain Bills of Lading, Tax Invoices/Freight Invoices, AND Customs Permits or Outward Permits. STEP 1: Scan EVERY page. STEP 2: For each Tax Invoice or Freight Invoice page found (carrier letterhead, charge table, Amount Due), output one 'Payment Voucher/GL' entry with that invoice number. STEP 3: For each BL page, output one 'Bill of Lading' entry. STEP 4: Completely ignore Customs Permit / Outward Permit pages. A single PDF with 1 BL + 1 Tax Invoice must produce 2 entries. Do NOT combine invoice numbers. Do NOT sum amounts. Return valid JSON only. No explanation, no markdown."
      : role === "logistics"
      ? "This PDF contains logistics documents — it may include multiple Shipping Instructions from PULAU SAMBU SINGAPORE. STEP 1: Scan EVERY single page — do not stop early. STEP 2: For EACH Shipping Instruction (2-page document with PULAU SAMBU SINGAPORE letterhead), create ONE separate 'Outward Permit Declaration' entry — find the container number and seal number in the 'FOR SHIPPING DEPARTMENT ONLY' section on page 2 of each SI. STEP 3: If this chunk has 15 Shipping Instructions, output 15 separate entries. Do NOT combine multiple SIs into one entry. Do NOT skip any SI. Return valid JSON only. No explanation, no markdown."
      : "Extract all documents from this PDF and return valid JSON only. No explanation, no markdown — just the JSON object."
  );

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const stream = client.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 32000,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: base64 },
              },
              { type: "text", text: resolvedUserText },
            ],
          },
        ],
      });

      const response = await stream.finalMessage();
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      if (!text) throw new Error("No data returned from Claude");

      res.status(200).json({ text });
      return;
    } catch (error: any) {
      if (attempt === maxRetries) {
        res.status(500).json({ error: error.message || "Extraction failed" });
        return;
      }
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
    }
  }
}
