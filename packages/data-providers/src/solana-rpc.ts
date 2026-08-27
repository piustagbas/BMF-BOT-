import type { ProviderResult, SourceHealth } from './types';
import { fetchWithTimeout } from './http';

function rpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
  );
}

async function rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetchWithTimeout(
    rpcUrl(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    },
    8000,
  );
  if (!res.ok) {
    throw new Error(`Solana RPC HTTP ${res.status}`);
  }
  const payload = (await res.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (payload.error) {
    throw new Error(payload.error.message ?? 'Solana RPC error');
  }
  return payload.result as T;
}

export async function getTokenDecimals(
  mint: string,
): Promise<ProviderResult<number>> {
  try {
    const supply = await rpcCall<{
      value?: { decimals?: number };
    }>('getTokenSupply', [mint]);
    const decimals = supply?.value?.decimals;
    if (typeof decimals !== 'number') {
      return { ok: false, error: 'decimals unavailable' };
    }
    return { ok: true, data: decimals };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'getTokenSupply failed',
    };
  }
}

export async function getTokenAccountsByOwner(
  owner: string,
  mint: string,
): Promise<ProviderResult<unknown>> {
  try {
    const result = await rpcCall<unknown>('getTokenAccountsByOwner', [
      owner,
      { mint },
      { encoding: 'jsonParsed' },
    ]);
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'getTokenAccountsByOwner failed',
    };
  }
}

export async function getSolanaSlot(): Promise<ProviderResult<number>> {
  try {
    const slot = await rpcCall<number>('getSlot');
    return { ok: true, data: slot };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'getSlot failed',
    };
  }
}

export async function pingSolanaRpc(): Promise<SourceHealth> {
  const started = Date.now();
  try {
    const health = await rpcCall<string>('getHealth');
    const latencyMs = Date.now() - started;
    if (health === 'ok') {
      return { status: 'ONLINE', latencyMs };
    }
    return {
      status: 'DEGRADED',
      message: `getHealth=${health}`,
      latencyMs,
    };
  } catch (err) {
    return {
      status: 'OFFLINE',
      message: err instanceof Error ? err.message : 'unreachable',
    };
  }
}
