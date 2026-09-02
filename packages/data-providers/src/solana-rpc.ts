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

export async function getSolBalanceLamports(
  owner: string,
): Promise<ProviderResult<number>> {
  try {
    const result = await rpcCall<number>('getBalance', [owner]);
    return { ok: true, data: typeof result === 'number' ? result : 0 };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'getBalance failed',
    };
  }
}

export async function getSplTokenUiBalance(
  owner: string,
  mint: string,
): Promise<ProviderResult<{ uiAmount: number; amount: string; decimals: number }>> {
  try {
    const result = await rpcCall<{
      value?: Array<{
        account?: {
          data?: {
            parsed?: {
              info?: {
                tokenAmount?: {
                  uiAmount?: number | null;
                  amount?: string;
                  decimals?: number;
                };
              };
            };
          };
        };
      }>;
    }>('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed' }]);
    const accounts = result?.value ?? [];
    let uiAmount = 0;
    let amount = '0';
    let decimals = 0;
    for (const acc of accounts) {
      const ta = acc.account?.data?.parsed?.info?.tokenAmount;
      if (!ta) continue;
      uiAmount += Number(ta.uiAmount ?? 0);
      if (ta.amount && BigInt(ta.amount) > BigInt(amount)) {
        amount = ta.amount;
      }
      if (typeof ta.decimals === 'number') decimals = ta.decimals;
    }
    return { ok: true, data: { uiAmount, amount, decimals } };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'SPL balance failed',
    };
  }
}

export type SignatureConfirmation = {
  confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
  err: unknown;
  slot: number | null;
};

export async function getSignatureStatuses(
  signatures: string[],
): Promise<ProviderResult<Array<SignatureConfirmation | null>>> {
  try {
    const result = await rpcCall<{
      value?: Array<{
        confirmationStatus?: string | null;
        err?: unknown;
        slot?: number;
      } | null>;
    }>('getSignatureStatuses', [signatures, { searchTransactionHistory: true }]);
    const values: Array<SignatureConfirmation | null> = (result?.value ?? []).map((v) => {
      if (!v) return null;
      const status = v.confirmationStatus;
      const confirmationStatus: SignatureConfirmation['confirmationStatus'] =
        status === 'processed' || status === 'confirmed' || status === 'finalized'
          ? status
          : null;
      return {
        confirmationStatus,
        err: v.err ?? null,
        slot: typeof v.slot === 'number' ? v.slot : null,
      } satisfies SignatureConfirmation;
    });
    return { ok: true, data: values };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'getSignatureStatuses failed',
    };
  }
}

export async function waitForSignatureConfirmation(
  signature: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<
  ProviderResult<{
    status: 'confirmed' | 'failed' | 'pending';
    confirmationStatus: SignatureConfirmation['confirmationStatus'];
    err: unknown;
  }>
> {
  const timeoutMs = opts?.timeoutMs ?? 20_000;
  const intervalMs = opts?.intervalMs ?? 2000;
  const started = Date.now();
  let lastUnavailable: string | undefined;
  while (Date.now() - started < timeoutMs) {
    const res = await getSignatureStatuses([signature]);
    if (!res.ok) {
      lastUnavailable = res.error;
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }
    const st = res.data?.[0];
    if (st?.err) {
      return {
        ok: true,
        data: { status: 'failed', confirmationStatus: st.confirmationStatus, err: st.err },
      };
    }
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') {
      return {
        ok: true,
        data: {
          status: 'confirmed',
          confirmationStatus: st.confirmationStatus,
          err: null,
        },
      };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  if (lastUnavailable) {
    return { ok: false, unavailable: true, error: lastUnavailable };
  }
  return {
    ok: true,
    data: { status: 'pending', confirmationStatus: 'processed', err: null },
  };
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
