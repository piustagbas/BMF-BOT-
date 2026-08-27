import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { colors, common, spacing } from '../theme';

type Props = {
  address: string;
  compact?: boolean;
};

export function CopyableAddress({ address, compact = false }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!address) return;
    try {
      await Clipboard.setStringAsync(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <View
      style={{
        marginTop: compact ? 6 : spacing.sm,
        padding: compact ? 8 : 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgElevated,
      }}
    >
      <Text style={[common.cardBody, { fontSize: 11, marginBottom: 4 }]}>Mint address</Text>
      <Text
        selectable
        style={{
          color: colors.text,
          fontSize: compact ? 11 : 12,
          fontFamily: 'Courier',
          lineHeight: 16,
        }}
      >
        {address}
      </Text>
      <Pressable
        onPress={() => void copy()}
        style={[common.secondaryBtn, { marginTop: 8, paddingVertical: 8 }]}
      >
        <Text style={common.secondaryBtnText}>{copied ? 'Copied' : 'Copy address'}</Text>
      </Pressable>
    </View>
  );
}
