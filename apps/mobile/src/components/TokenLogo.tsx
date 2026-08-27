import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

type Props = {
  uri?: string | null;
  symbol?: string | null;
  size?: number;
};

export function TokenLogo({ uri, symbol, size = 40 }: Props) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const letter = (symbol ?? '?').trim().replace(/^\$/, '').slice(0, 1).toUpperCase() || '?';
  const showImage = Boolean(uri) && !failed;

  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: uri! }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFailed(true)}
          accessibilityLabel={`${symbol ?? 'token'} logo`}
        />
      ) : (
        <Text style={[styles.letter, { fontSize: Math.max(12, size * 0.38) }]}>{letter}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  letter: {
    color: colors.muted,
    fontWeight: '700',
  },
});
