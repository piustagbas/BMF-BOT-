import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  fetchNotificationInbox,
  markAllNotificationsRead,
  markNotificationRead,
  type InboxItem,
} from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { colors, common } from '../theme';
import type { RootStackParamList } from '../navigation/types';

export function NotificationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchNotificationInbox(80);
      setItems(res.items);
      setUnread(res.unread);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const open = async (item: InboxItem) => {
    await markNotificationRead(item.id).catch(() => undefined);
    const address = item.action?.params?.address ?? item.tokenAddress;
    if (address) {
      const sell = item.type === 'TAKE_PROFIT' || item.type === 'STOP_LOSS';
      navigation.navigate('TokenDetails', { address, action: sell ? 'SELL' : undefined });
    }
    void load();
  };

  return (
    <View style={common.screen}>
      <View style={common.row}>
        <Text style={common.title}>Notifications</Text>
        {unread > 0 ? <StatusBadge label={`${unread} unread`} tone="warn" /> : null}
      </View>
      <Text style={common.subtitle}>Trade, pending, confirmed, failed, take-profit, and stop-loss events.</Text>
      {error ? (
        <View style={common.card}>
          <StatusBadge label="ERROR" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}
      <Pressable
        style={[common.secondaryBtn, { marginBottom: 8 }]}
        onPress={() => void markAllNotificationsRead().then(() => load())}
      >
        <Text style={common.secondaryBtnText}>Mark all read</Text>
      </Pressable>
      {loading && items.length === 0 ? <ActivityIndicator color={colors.accent} /> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        ListEmptyComponent={!loading ? <Text style={common.cardBody}>No notifications yet.</Text> : null}
        renderItem={({ item }) => (
          <Pressable style={[common.card, !item.read && { borderColor: colors.accent }]} onPress={() => void open(item)}>
            <View style={common.row}>
              <StatusBadge label={item.type.replace('_', ' ')} tone={item.read ? 'info' : 'ok'} />
              <Text style={common.cardBody}>{item.createdAt.slice(11, 19)}</Text>
            </View>
            <Text style={common.cardTitle}>{item.title}</Text>
            <Text style={common.cardBody}>{item.body}</Text>
            {item.action ? (
              <Text style={{ color: colors.accent, marginTop: 8, fontWeight: '700' }}>{item.action.label} →</Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}
