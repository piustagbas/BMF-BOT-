import React from 'react';
import { Image, Text, View } from 'react-native';
import { colors } from '../theme';

const logo = require('../../assets/logo.png');

type Props = {
  size?: number;
  showWordmark?: boolean;
};

export function AppLogo({ size = 72, showWordmark = false }: Props) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Image
        source={logo}
        accessibilityLabel="BMF Bot"
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.22,
        }}
      />
      {showWordmark ? (
        <Text
          style={{
            color: colors.text,
            fontSize: 22,
            fontWeight: '800',
            letterSpacing: -0.4,
            marginTop: 12,
          }}
        >
          BMF Bot
        </Text>
      ) : null}
    </View>
  );
}

export function BrandHeaderTitle() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Image
        source={logo}
        accessibilityLabel="BMF Bot"
        style={{ width: 28, height: 28, borderRadius: 7 }}
      />
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, letterSpacing: -0.2 }}>
        BMF Bot
      </Text>
    </View>
  );
}
