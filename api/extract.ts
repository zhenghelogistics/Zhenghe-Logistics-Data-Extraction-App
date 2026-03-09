import Anthropic from "@anthropic-ai/sdk";

// Vercel serverless function — API key stays server-side, never exposed to browser
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Read raw body as stream to handle large PDF base64 payloads
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

  const { base64, systemPrompt } = body;
  if (!base64 || !systemPrompt) {
    res.status(400).json({ error: "Missing required fields: base64, systemPrompt" });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in environment variables" });
    return;
  }

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
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
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64,
                },
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
      const result = JSON.parse(clean);
      res.status(200).json(result);
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
