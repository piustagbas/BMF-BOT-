import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { fetchNotificationInbox } from '../api/client';
import { colors } from '../theme';
import type { RootStackParamList } from '../navigation/types';

export function NotificationBell() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetchNotificationInbox(1);
      setUnread(res.unread);
    } catch {
      /* ignore */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    const id = setInterval(() => void load(), 15000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <Pressable
      onPress={() => {
        const root = navigation.getParent() as
          | NativeStackNavigationProp<RootStackParamList>
          | undefined;
        (root ?? navigation).navigate('Notifications');
      }}
      hitSlop={10}
      style={{ paddingHorizontal: 8, paddingVertical: 4 }}
    >
      <View>
        <Ionicons name="notifications-outline" size={22} color={colors.text} />
        {unread > 0 ? (
          <View
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: colors.danger,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 3,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>
              {unread > 9 ? '9+' : unread}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
