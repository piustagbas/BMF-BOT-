import React from 'react';
import { Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';

export function BetBotFab({ onPress, count }: { onPress: () => void; count?: number }) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      style={{
        position: 'absolute',
        top: Math.max(insets.top, 8) + 4,
        right: 12,
        zIndex: 80,
        backgroundColor: colors.accent,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowRadius: 8,
        elevation: 6,
      }}
    >
      <Text style={{ color: '#04140E', fontWeight: '900', fontSize: 12, letterSpacing: 0.6 }}>
        BET BOT{count ? ` · ${count}` : ''}
      </Text>
    </Pressable>
  );
}
