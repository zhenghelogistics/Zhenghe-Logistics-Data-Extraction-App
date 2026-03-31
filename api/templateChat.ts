import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

// General-purpose Claude endpoint for TemplatesTab — scan, test, discovery
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

  const { base64, systemPrompt, userText, maxTokens, prefill } = body;
  if (!userText) {
    res.status(400).json({ error: "Missing required field: userText" });
    return;
  }

  if (base64 && base64.length > 20_000_000) {
    res.status(413).json({ error: "File too large" });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not set" });
    return;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userContent: any[] = [];
  if (base64) {
    userContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } });
  }
  userContent.push({ type: "text", text: userText });

  const messages: any[] = [{ role: "user", content: userContent }];
  if (prefill) {
    messages.push({ role: "assistant", content: [{ type: "text", text: prefill }] });
  }

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens ?? 1024,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages,
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    res.status(200).json({ text });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Request failed" });
  }
}
