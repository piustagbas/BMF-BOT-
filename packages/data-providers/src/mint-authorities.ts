import type { ProviderResult } from './types';
import { fetchWithTimeout } from './http';

/**
 * Cross-check mint/freeze authorities directly from Solana mint account.
 * SPL Token mint layout: mintAuthorityOption (u32) @0, mintAuthority (32) @4,
 * supply (u64) @36, decimals (u8) @44, ... freezeAuthorityOption @46, freezeAuthority @50
 */
export type MintAuthorities = {
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  source: 'solana_rpc';
};

function rpcUrl(): string {
  return process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
}

function readU32LE(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

export function parseMintAuthoritiesFromBase64(
  dataBase64: string,
): MintAuthorities {
  const buf = Buffer.from(dataBase64, 'base64');
  if (buf.length < 82) {
    return {
      mintAuthorityRevoked: null,
      freezeAuthorityRevoked: null,
      source: 'solana_rpc',
    };
  }
  const mintAuthOption = readU32LE(buf, 0);
  const freezeAuthOption = readU32LE(buf, 46);
  return {
    mintAuthorityRevoked: mintAuthOption === 0,
    freezeAuthorityRevoked: freezeAuthOption === 0,
    source: 'solana_rpc',
  };
}

export async function fetchMintAuthorities(
  mint: string,
): Promise<ProviderResult<MintAuthorities>> {
  try {
    const res = await fetchWithTimeout(
      rpcUrl(),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [mint, { encoding: 'base64' }],
        }),
      },
      8000,
    );
    if (!res.ok) {
      return {
        ok: false,
        unavailable: true,
        error: `Solana getAccountInfo HTTP ${res.status}`,
      };
    }
    const payload = (await res.json()) as {
      result?: { value?: { data?: [string, string] } | null };
      error?: { message?: string };
    };
    if (payload.error) {
      return { ok: false, error: payload.error.message ?? 'RPC error' };
    }
    const data = payload.result?.value?.data?.[0];
    if (!data) {
      return { ok: false, error: 'Mint account not found' };
    }
    return { ok: true, data: parseMintAuthoritiesFromBase64(data) };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'Mint authority check failed',
    };
  }
}
