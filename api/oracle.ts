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
  return `The user asked a real question. You must give three different advisory angles that clearly refer to what they are asking about (same topic, people, or decision—not generic life advice).

Reply with ONLY valid JSON (no markdown, no code fences) exactly in this shape:
{"options":["…","…","…"]}

Hard rules:
- Exactly 3 strings in "options", each 10–45 words.
- Each option must mention or clearly imply the subject of their question (restate a noun/verb from it, or paraphrase the situation). No vague fortune-cookie lines that could apply to anyone.
- Option A: lean toward acting / yes / moving forward. Option B: lean toward waiting / gathering more info. Option C: lean toward caution / smaller step / risk-aware.
- Practical and kind. No medical, legal, or financial certainty. No hate or harassment.
- One paragraph per string; no line breaks inside a string.

User question: ${embedded}`;
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
      system_instruction: {
        parts: [
          {
            text: 'You only output JSON. Each suggestion must explicitly address the user’s question—reuse their topic, choice, or named people. No generic advice that ignores what they asked.',
          },
        ],
      },
      contents: [{ role: 'user', parts: [{ text: buildPrompt(prompt) }] }],
      generationConfig: {
        temperature: 0.55,
        responseMimeType: 'application/json',
      },
    }),
  });

  const raw = (await geminiRes.json()) as GeminiGenerateResponse;

  if (!geminiRes.ok) {
    const msg = raw.error?.message ?? geminiRes.statusText;
    return res.status(502).json({ error: msg });
  }

  const candidate = raw.candidates?.[0];
  const finish = (candidate as { finishReason?: string } | undefined)?.finishReason;
  if (finish && finish !== 'STOP') {
    return res.status(502).json({ error: `Model stopped: ${finish}` });
  }

  const text = candidate?.content?.parts?.[0]?.text;
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
