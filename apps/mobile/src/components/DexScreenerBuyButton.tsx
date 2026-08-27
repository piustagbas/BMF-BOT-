import React, { useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { common } from '../theme';
import { openInDexScreener } from '../utils/dexscreener';

type Props = {
  mint: string;
  pairAddress?: string | null;
  compact?: boolean;
};

export function DexScreenerBuyButton({ mint, pairAddress, compact }: Props) {
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    try {
      await openInDexScreener({ mint, pairAddress });
    } catch (err) {
      Alert.alert(
        'DexScreener',
        err instanceof Error ? err.message : 'Could not open DexScreener.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      style={compact ? common.secondaryBtn : common.primaryBtn}
      disabled={busy}
      onPress={() => void open()}
    >
      <Text style={compact ? common.secondaryBtnText : common.primaryBtnText}>
        {busy ? 'Opening DexScreener…' : 'Buy on DexScreener'}
      </Text>
    </Pressable>
  );
}
