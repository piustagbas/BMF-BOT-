import { Linking } from 'react-native';
import { dexScreenerSolanaUrl } from '@memecoinbot/shared';

export { dexScreenerSolanaUrl };

export async function openInDexScreener(opts: {
  mint: string;
  pairAddress?: string | null;
}): Promise<void> {
  const url = dexScreenerSolanaUrl(opts.mint, opts.pairAddress);
  await Linking.openURL(url);
}
