import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

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

  const { base64, listLines } = body;
  if (!base64 || !listLines) {
    res.status(400).json({ error: "Missing required fields: base64, listLines" });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not set" });
    return;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
            {
              type: "text",
              text: `For each Bill of Lading below, find the PSS or SI invoice number that Zhenghe / PSS Logistics stamped or printed on the invoice page. These numbers often start with # (e.g. #25101630).

${listLines}

Return ONLY a JSON object — BL number as key, PSS/SI number (or null) as value:
{"MEDUUD123456": "#25101234", "MEDUUD999999": null}`,
            },
          ],
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    res.status(200).json({ text });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "PSS enrichment failed" });
  }
}
