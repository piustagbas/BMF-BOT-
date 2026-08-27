const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  // DexScreener / Cloudflare often serve a challenge page without a UA.
  'User-Agent':
    'Mozilla/5.0 (compatible; Memecoinbot/1.0; +https://github.com/memecoinbot)',
};

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  const run = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...DEFAULT_HEADERS,
          ...(init.headers ?? {}),
        },
      });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const res = await run();
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 600));
      return run();
    }
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('abort') || msg.includes('Abort') || msg.includes('fetch')) {
      await new Promise((r) => setTimeout(r, 400));
      return run();
    }
    throw err;
  }
}

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
