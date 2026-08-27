import type {
  JupiterPriceQuote,
  JupiterSwapQuote,
  JupiterSwapTransaction,
  ProviderResult,
  SourceHealth,
} from './types';
import { fetchWithTimeout, num } from './http';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export { SOL as SOL_MINT, USDC as USDC_MINT };

function quoteBase(): string {
  return (
    process.env.JUPITER_QUOTE_API_URL?.replace(/\/$/, '') ||
    'https://lite-api.jup.ag/swap/v1'
  );
}

/**
 * Cross-check helper: get an indicative USD price via Jupiter quote route.
 * Uses a small notional and fails safely when routes are unavailable.
 */
export async function fetchJupiterPrice(
  mint: string,
  decimals = 6,
): Promise<ProviderResult<JupiterPriceQuote>> {
  try {
    // 1 whole token in smallest units (capped decimals assumption for memes)
    const amount = BigInt(10) ** BigInt(Math.min(Math.max(decimals, 0), 9));
    const url =
      `${quoteBase()}/quote?inputMint=${encodeURIComponent(mint)}` +
      `&outputMint=${USDC}&amount=${amount.toString()}&slippageBps=100`;

    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) {
      // Many meme tokens have no Jupiter route — treat as soft unavailable, not fatal
      if (res.status === 400 || res.status === 404) {
        return {
          ok: true,
          data: { mint, priceUsd: null, routeAvailable: false },
        };
      }
      return {
        ok: false,
        unavailable: res.status >= 500,
        error: `Jupiter HTTP ${res.status}`,
      };
    }

    const payload = (await res.json()) as Record<string, unknown>;
    const outAmount = num(payload.outAmount);
    // USDC has 6 decimals
    const priceUsd = outAmount !== null ? outAmount / 1_000_000 : null;

    return {
      ok: true,
      data: {
        mint,
        priceUsd,
        routeAvailable: priceUsd !== null,
        raw: payload,
      },
    };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'Jupiter request failed',
    };
  }
}

/**
 * Fetch a Jupiter swap quote (buy meme with SOL by default).
 * Never signs or broadcasts — quote only.
 */
export async function fetchJupiterSwapQuote(params: {
  inputMint: string;
  outputMint: string;
  amountAtomic: string;
  slippageBps?: number;
}): Promise<ProviderResult<JupiterSwapQuote>> {
  try {
    const slippageBps = params.slippageBps ?? 100;
    const url =
      `${quoteBase()}/quote?inputMint=${encodeURIComponent(params.inputMint)}` +
      `&outputMint=${encodeURIComponent(params.outputMint)}` +
      `&amount=${encodeURIComponent(params.amountAtomic)}` +
      `&slippageBps=${slippageBps}`;

    const res = await fetchWithTimeout(url, {}, 10_000);
    if (!res.ok) {
      return {
        ok: false,
        unavailable: res.status >= 500,
        error: `Jupiter quote HTTP ${res.status}`,
      };
    }

    const payload = (await res.json()) as Record<string, unknown>;
    const inAmount = String(payload.inAmount ?? params.amountAtomic);
    const outAmount = String(payload.outAmount ?? '');
    if (!outAmount) {
      return { ok: false, error: 'Jupiter quote missing outAmount' };
    }

    const routePlan = Array.isArray(payload.routePlan) ? payload.routePlan : [];
    return {
      ok: true,
      data: {
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        inAmount,
        outAmount,
        otherAmountThreshold: String(payload.otherAmountThreshold ?? outAmount),
        slippageBps,
        priceImpactPct: num(payload.priceImpactPct),
        routePlanLength: routePlan.length,
        raw: payload,
      },
    };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'Jupiter quote failed',
    };
  }
}

/**
 * Build an unsigned swap transaction for the user to sign in their wallet.
 * Server never holds private keys.
 */
export async function buildJupiterSwapTransaction(params: {
  quoteResponse: Record<string, unknown>;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
}): Promise<ProviderResult<JupiterSwapTransaction>> {
  try {
    const res = await fetchWithTimeout(
      `${quoteBase()}/swap`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: params.quoteResponse,
          userPublicKey: params.userPublicKey,
          wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? true,
          dynamicComputeUnitLimit: true,
        }),
      },
      15_000,
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        unavailable: res.status >= 500,
        error: `Jupiter swap HTTP ${res.status}: ${body.slice(0, 160)}`,
      };
    }

    const payload = (await res.json()) as Record<string, unknown>;
    const swapTransaction = payload.swapTransaction;
    if (typeof swapTransaction !== 'string' || !swapTransaction) {
      return { ok: false, error: 'Jupiter swap missing swapTransaction' };
    }

    return {
      ok: true,
      data: {
        swapTransaction,
        lastValidBlockHeight: num(payload.lastValidBlockHeight),
      },
    };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'Jupiter swap build failed',
    };
  }
}

export async function pingJupiter(): Promise<SourceHealth> {
  const started = Date.now();
  try {
    const url =
      `${quoteBase()}/quote?inputMint=${SOL}&outputMint=${USDC}&amount=1000000&slippageBps=50`;
    const res = await fetchWithTimeout(url, {}, 5000);
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return { status: 'OFFLINE', message: `HTTP ${res.status}`, latencyMs };
    }
    return { status: 'ONLINE', latencyMs };
  } catch (err) {
    return {
      status: 'OFFLINE',
      message: err instanceof Error ? err.message : 'unreachable',
    };
  }
}
