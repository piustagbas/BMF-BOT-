import React from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { colors, common, spacing } from '../theme';
import type { MoreStackParamList, RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<MoreStackParamList, 'MoreHome'>;

const LINKS: Array<{
  title: string;
  subtitle: string;
  route: keyof MoreStackParamList;
}> = [
  {
    title: 'Demo trading',
    subtitle: 'Simulated fills · $1,000 default · no chain txs',
    route: 'Paper',
  },
  {
    title: 'Real trades',
    subtitle: 'Approve-only proposals · kill switch · auto dry-run',
    route: 'Trade',
  },
  {
    title: 'Backtests',
    subtitle: 'In-sample vs out-of-sample strategy checks',
    route: 'Backtest',
  },
  {
    title: 'BUY results',
    subtitle: 'Success / fail / open for BUY setups you skipped',
    route: 'Outcomes',
  },
  {
    title: 'Smart money',
    subtitle: 'Auto-discovered wallets · scores · consensus (not copy-trading)',
    route: 'SmartMoney',
  },
  {
    title: 'Settings',
    subtitle: 'Risk filters · optional extra wallets · notifications',
    route: 'Settings',
  },
];

export function MoreScreen({ navigation }: Props) {
  const { user, logout } = useAuth();
  const openBetBot = () => {
    const root = navigation.getParent()?.getParent() as
      | NativeStackNavigationProp<RootStackParamList>
      | undefined;
    root?.navigate('BetBot');
  };
  const openForexBot = () => {
    const root = navigation.getParent()?.getParent() as
      | NativeStackNavigationProp<RootStackParamList>
      | undefined;
    root?.navigate('ForexBot');
  };
  const openRoot = (route: 'Portfolio' | 'TradeHistory' | 'Notifications') => {
    const root = navigation.getParent()?.getParent() as
      | NativeStackNavigationProp<RootStackParamList>
      | undefined;
    root?.navigate(route);
  };

  return (
    <ScrollView
      style={common.screen}
      contentContainerStyle={{ paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator
    >
      <Text style={common.title}>More</Text>
      <Text style={common.subtitle}>
        Signed in as {user?.email ?? 'user'}. Watchlist and settings persist in MongoDB.
      </Text>
      <Pressable
        onPress={openForexBot}
        style={({ pressed }) => [common.card, pressed && { backgroundColor: colors.surfaceHover }]}
      >
        <Text style={common.cardTitle}>FX BOT</Text>
        <Text style={common.cardBody}>
          Scan → filter → score → you click BUY/SELL → live recheck → demo fill. Kill switch blocks live only.
        </Text>
        <Text style={{ color: colors.info, marginTop: spacing.sm, fontWeight: '700' }}>
          Open →
        </Text>
      </Pressable>
      <Pressable
        onPress={openBetBot}
        style={({ pressed }) => [common.card, pressed && { backgroundColor: colors.surfaceHover }]}
      >
        <Text style={common.cardTitle}>BET BOT</Text>
        <Text style={common.cardBody}>
          Football fixtures · safety score · bet slip (no fake booking codes)
        </Text>
        <Text style={{ color: colors.accent, marginTop: spacing.sm, fontWeight: '700' }}>
          Open →
        </Text>
      </Pressable>
      <Pressable
        onPress={() => openRoot('Portfolio')}
        style={({ pressed }) => [common.card, pressed && { backgroundColor: colors.surfaceHover }]}
      >
        <Text style={common.cardTitle}>Portfolio</Text>
        <Text style={common.cardBody}>Live positions · avg entry · unrealized PnL after confirmed trades</Text>
        <Text style={{ color: colors.accent, marginTop: spacing.sm, fontWeight: '700' }}>Open →</Text>
      </Pressable>
      <Pressable
        onPress={() => openRoot('TradeHistory')}
        style={({ pressed }) => [common.card, pressed && { backgroundColor: colors.surfaceHover }]}
      >
        <Text style={common.cardTitle}>Trade history</Text>
        <Text style={common.cardBody}>In-app buys and sells with fees, hash, and confirmation status</Text>
        <Text style={{ color: colors.accent, marginTop: spacing.sm, fontWeight: '700' }}>Open →</Text>
      </Pressable>
      <Pressable
        onPress={() => openRoot('Notifications')}
        style={({ pressed }) => [common.card, pressed && { backgroundColor: colors.surfaceHover }]}
      >
        <Text style={common.cardTitle}>Notifications</Text>
        <Text style={common.cardBody}>Trade, take-profit, stop-loss, pending and failed events</Text>
        <Text style={{ color: colors.accent, marginTop: spacing.sm, fontWeight: '700' }}>Open →</Text>
      </Pressable>
      {LINKS.map((link) => (
        <Pressable
          key={link.route}
          onPress={() => navigation.navigate(link.route)}
          style={({ pressed }) => [
            common.card,
            pressed && { backgroundColor: colors.surfaceHover },
          ]}
        >
          <Text style={common.cardTitle}>{link.title}</Text>
          <Text style={common.cardBody}>{link.subtitle}</Text>
          <Text style={{ color: colors.accent, marginTop: spacing.sm, fontWeight: '700' }}>
            Open →
          </Text>
        </Pressable>
      ))}
      <Pressable
        style={[common.card, { borderColor: colors.danger }]}
        onPress={() => void logout()}
      >
        <Text style={[common.cardTitle, { color: colors.danger }]}>Log out</Text>
        <Text style={common.cardBody}>Clears JWT from this device (Lingua-style).</Text>
      </Pressable>
    </ScrollView>
  );
}
