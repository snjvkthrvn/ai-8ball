import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Swap model if this ID isn’t enabled on your key yet (e.g. `gemini-1.5-flash`). */
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
};

function buildPrompt(userPrompt: string): string {
  const embedded = JSON.stringify(userPrompt);
  return `You are a Magic 8 Ball–style advisor. For the user's question, reply with ONLY valid JSON (no markdown, no code fences) in this exact shape:
{"options":["first suggestion","second suggestion","third suggestion"]}

Rules:
- Exactly 3 strings in "options", each 8–40 words, distinct tones (e.g. proceed / wait / cautious).
- Practical and kind; no fatalism, no medical/legal certainty, no hate.
- Plain text inside strings only (no line breaks inside a string).

Question: ${embedded}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Server missing GEMINI_API_KEY or GOOGLE_API_KEY' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  const geminiRes = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPrompt(prompt) }] }],
      generationConfig: {
        temperature: 0.85,
        responseMimeType: 'application/json',
      },
    }),
  });

  const raw = (await geminiRes.json()) as GeminiGenerateResponse;

  if (!geminiRes.ok) {
    const msg = raw.error?.message ?? geminiRes.statusText;
    return res.status(502).json({ error: msg });
  }

  const text = raw.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return res.status(502).json({ error: 'Empty model response' });
  }

  let parsed: { options?: unknown };
  try {
    parsed = JSON.parse(text) as { options?: unknown };
  } catch {
    return res.status(502).json({ error: 'Model returned non-JSON' });
  }

  const options = parsed.options;
  if (!Array.isArray(options)) {
    return res.status(502).json({ error: 'Invalid JSON shape' });
  }

  const cleaned = options
    .filter((o): o is string => typeof o === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 3);

  if (cleaned.length < 3) {
    return res.status(502).json({ error: 'Need 3 options from model' });
  }

  return res.status(200).json({ options: cleaned });
}
