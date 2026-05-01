import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Try in order — many keys only expose 1.5 Flash; 2.x can 404 until enabled in AI Studio. */
const MODEL_CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
] as const;

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; code?: number; status?: string };
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

/** Vercel sometimes delivers `body` as a Buffer, string, or pre-parsed object. */
function parseRequestBody(req: VercelRequest): { prompt?: string } | null {
  const raw = req.body as unknown;
  if (raw == null || raw === '') {
    return null;
  }
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) {
    return raw as { prompt?: string };
  }
  const str = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  try {
    return JSON.parse(str) as { prompt?: string };
  } catch {
    return null;
  }
}

function extractText(raw: GeminiGenerateResponse): string | null {
  const block = raw.promptFeedback?.blockReason;
  if (block) {
    return null;
  }
  const parts = raw.candidates?.[0]?.content?.parts;
  const text = parts?.map((p) => p.text).join('')?.trim();
  return text && text.length > 0 ? text : null;
}

function normalizeOptions(parsed: { options?: unknown }): string[] | null {
  const options = parsed.options;
  if (!Array.isArray(options)) {
    return null;
  }
  const cleaned = options
    .filter((o): o is string => typeof o === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 3);
  return cleaned.length >= 3 ? cleaned : null;
}

async function generateWithModel(
  apiKey: string,
  modelId: string,
  userText: string,
  withSystemInstruction: boolean,
): Promise<{ ok: true; text: string } | { ok: false; status: number; google: GeminiGenerateResponse }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;

  const payload: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(userText) }] }],
    generationConfig: {
      temperature: 0.55,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  };

  if (withSystemInstruction) {
    payload.systemInstruction = {
      parts: [
        {
          text: 'You only output JSON. Each suggestion must explicitly address the user’s question—reuse their topic, choice, or named people. No generic advice that ignores what they asked.',
        },
      ],
    };
  }

  const geminiRes = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  const raw = (await geminiRes.json()) as GeminiGenerateResponse;

  if (!geminiRes.ok) {
    return { ok: false, status: geminiRes.status, google: raw };
  }

  const text = extractText(raw);
  if (!text) {
    const finish = raw.candidates?.[0]?.finishReason;
    const block = raw.promptFeedback?.blockReason;
    return {
      ok: false,
      status: 502,
      google: {
        error: {
          message: block
            ? `Prompt blocked: ${block}`
            : finish
              ? `No text (finish: ${finish})`
              : 'Empty model response — check safety filters or quota.',
        },
      },
    };
  }

  return { ok: true, text };
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

  const keyRaw = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const key = typeof keyRaw === 'string' ? keyRaw.trim() : '';
  if (!key) {
    return res.status(500).json({ error: 'Server missing GEMINI_API_KEY or GOOGLE_API_KEY' });
  }

  const body = parseRequestBody(req);
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return res.status(400).json({ error: 'Missing or invalid JSON body; expected {"prompt":"..."}' });
  }

  let lastErr: string | undefined;

  for (const modelId of MODEL_CANDIDATES) {
    for (const withSys of [true, false]) {
      const result = await generateWithModel(key, modelId, prompt, withSys);

      if (result.ok) {
        let parsed: { options?: unknown };
        try {
          parsed = JSON.parse(result.text) as { options?: unknown };
        } catch {
          lastErr = `Model ${modelId}: returned non-JSON text`;
          continue;
        }

        const cleaned = normalizeOptions(parsed);
        if (cleaned) {
          return res.status(200).json({ options: cleaned, model: modelId });
        }
        lastErr = `Model ${modelId}: JSON missing 3 options`;
        continue;
      }

      const msg = result.google.error?.message ?? 'Unknown Google error';
      lastErr = `${modelId} (${withSys ? 'sys' : 'nosys'}): ${msg}`;

      const notFound =
        result.status === 404 ||
        /NOT_FOUND|not found|404/i.test(msg) ||
        result.google.error?.status === 'NOT_FOUND';
      if (notFound) {
        break;
      }

      const maybeJsonMode =
        /responseMimeType|JSON|invalid argument|UNIMPLEMENTED/i.test(msg);
      if (maybeJsonMode && withSys) {
        continue;
      }
    }
  }

  return res.status(502).json({
    error: 'All Gemini model attempts failed',
    detail: lastErr ?? 'No detail',
    hint: 'Confirm GEMINI_API_KEY in Vercel, Generative Language API enabled for the key’s project, and free-tier quota.',
  });
}
