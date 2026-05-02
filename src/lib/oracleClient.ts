const MAX_PROMPT_LENGTH = 500;

/**
 * Calls the serverless `/api/oracle` route. Same-origin on Vercel;
 * for local dev use `VITE_ORACLE_BASE_URL` (see `.env.example`).
 */
export async function fetchOracleOptions(prompt: string): Promise<string[]> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Question must be ${MAX_PROMPT_LENGTH} characters or fewer`);
  }

  const base = import.meta.env.VITE_ORACLE_BASE_URL?.replace(/\/$/, '') ?? '';
  const url = `${base}/api/oracle`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: trimmed }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Oracle ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as { options?: unknown };
  if (!Array.isArray(data.options)) {
    throw new Error('Oracle: bad response shape');
  }

  return data.options.filter((o): o is string => typeof o === 'string').map((s) => s.trim());
}
