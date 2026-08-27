import type { SmartWallet } from './constants';
import { VERIFIED_SMART_WALLETS } from './constants';

export function looksLikeSolanaAddress(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}

export function parseSmartWalletList(
  raw: string | undefined,
  origin: SmartWallet['origin'] = 'VERIFIED',
): SmartWallet[] {
  if (!raw?.trim()) return [];
  const out: SmartWallet[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const chunk = part.trim();
    if (!chunk) continue;
    const [addrRaw, ...labelParts] = chunk.split(':');
    const address = (addrRaw ?? '').trim();
    if (!looksLikeSolanaAddress(address) || seen.has(address)) continue;
    seen.add(address);
    out.push({
      address,
      label: labelParts.join(':').trim() || `${address.slice(0, 4)}…${address.slice(-4)}`,
      origin,
    });
  }
  return out;
}

export function getVerifiedSmartWallets(envValue?: string): SmartWallet[] {
  const fromEnv = parseSmartWalletList(envValue);
  const seen = new Set<string>();
  const merged: SmartWallet[] = [];
  for (const w of [...VERIFIED_SMART_WALLETS, ...fromEnv]) {
    if (!looksLikeSolanaAddress(w.address) || seen.has(w.address)) continue;
    seen.add(w.address);
    merged.push({ ...w, origin: 'VERIFIED' });
  }
  return merged;
}

export function mergeSmartWallets(
  verified: SmartWallet[],
  user: Array<{ address: string; label?: string }>,
): SmartWallet[] {
  const seen = new Set<string>();
  const out: SmartWallet[] = [];
  for (const w of verified) {
    if (!looksLikeSolanaAddress(w.address) || seen.has(w.address)) continue;
    seen.add(w.address);
    out.push({ ...w, origin: 'VERIFIED' });
  }
  for (const w of user) {
    if (!looksLikeSolanaAddress(w.address) || seen.has(w.address)) continue;
    seen.add(w.address);
    out.push({
      address: w.address.trim(),
      label: w.label?.trim() || `${w.address.slice(0, 4)}…${w.address.slice(-4)}`,
      origin: 'USER',
    });
  }
  return out;
}

/** Verified + user + auto-discovered wallets. Manual labels win over discovery. */
export function mergeAllSmartWallets(
  verified: SmartWallet[],
  user: Array<{ address: string; label?: string }>,
  discovered: Array<{ address: string; label?: string }> = [],
): SmartWallet[] {
  const base = mergeSmartWallets(verified, user);
  const seen = new Set(base.map((w) => w.address));
  const out = [...base];
  for (const w of discovered) {
    if (!looksLikeSolanaAddress(w.address) || seen.has(w.address)) continue;
    seen.add(w.address);
    out.push({
      address: w.address.trim(),
      label: w.label?.trim() || `${w.address.slice(0, 4)}…${w.address.slice(-4)}`,
      origin: 'DISCOVERED',
    });
  }
  return out;
}
