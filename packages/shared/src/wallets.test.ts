import { describe, expect, it } from 'vitest';
import {
  getVerifiedSmartWallets,
  looksLikeSolanaAddress,
  mergeAllSmartWallets,
  mergeSmartWallets,
  parseSmartWalletList,
} from './wallets';

const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const B = 'So11111111111111111111111111111111111111112';

describe('smart wallet helpers', () => {
  it('validates solana addresses', () => {
    expect(looksLikeSolanaAddress(A)).toBe(true);
    expect(looksLikeSolanaAddress('not-a-key')).toBe(false);
  });

  it('parses env lists with labels', () => {
    const list = parseSmartWalletList(`${A}:Bonk,${B}:Wrapped SOL`);
    expect(list).toHaveLength(2);
    expect(list[0]?.label).toBe('Bonk');
    expect(list[0]?.origin).toBe('VERIFIED');
  });

  it('merges verified and user wallets without duplicates', () => {
    const verified = getVerifiedSmartWallets(`${A}:Public`);
    const merged = mergeSmartWallets(verified, [{ address: A, label: 'Mine' }, { address: B }]);
    expect(merged).toHaveLength(2);
    expect(merged.find((w) => w.address === A)?.origin).toBe('VERIFIED');
    expect(merged.find((w) => w.address === B)?.origin).toBe('USER');
  });

  it('appends discovered wallets without overriding manual ones', () => {
    const merged = mergeAllSmartWallets(
      getVerifiedSmartWallets(`${A}:Public`),
      [],
      [{ address: B, label: 'Auto' }],
    );
    expect(merged.find((w) => w.address === B)?.origin).toBe('DISCOVERED');
    const withUser = mergeAllSmartWallets(
      [],
      [{ address: B, label: 'Mine' }],
      [{ address: B, label: 'Auto' }],
    );
    expect(withUser).toHaveLength(1);
    expect(withUser[0]?.origin).toBe('USER');
  });
});
