/** Short 3-letter codes for data providers shown on token cards / health. */
export const HEALTH_SOURCE_CODE: Record<string, string> = {
  api: 'API',
  database: 'MON',
  redis: 'RED',
  dexscreener: 'DEX',
  jupiter: 'JUP',
  solana_rpc: 'RPC',
  token_security: 'SEC',
  ohlcv: 'OHL',
  notifications: 'TGM',
  axiom: 'AXM',
};

export function marketSourceCode(source?: string | null): string | null {
  if (!source) return null;
  const s = source.toLowerCase();
  if (s.includes('dexscreener') || s === 'dex') return 'DEX';
  if (s.includes('gecko')) return 'GEK';
  return 'MKT';
}

/**
 * Active data tags for a token row — only sources that contributed.
 * DEX/GEK = market price, JUP = Jupiter quote, SEC = RugCheck safety.
 * Axiom is not wired — never show AXM.
 */
export function buildTokenSourceTags(opts: {
  marketSource?: string | null;
  jupiterPriceUsd?: number | null;
  axiomUnavailable?: boolean | null;
  safetyScore?: number | null;
}): string[] {
  const tags: string[] = [];
  const s = (opts.marketSource ?? '').toLowerCase();
  if (s.includes('dex')) tags.push('DEX');
  if (s.includes('gecko')) tags.push('GEK');
  if (!tags.length) {
    const market = marketSourceCode(opts.marketSource);
    if (market) tags.push(market);
  }
  if (opts.jupiterPriceUsd != null) tags.push('JUP');
  if (opts.safetyScore != null) tags.push('SEC');
  return tags;
}
