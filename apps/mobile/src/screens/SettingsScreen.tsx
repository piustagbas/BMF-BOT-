import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  addSmartWallet,
  fetchNotificationStatus,
  fetchNotifications,
  fetchRiskSettings,
  fetchSettings,
  fetchSmartWallets,
  removeSmartWallet,
  resetSettings,
  sendTestNotification,
  updateRiskSettings,
  updateSettings,
  type AppSettings,
  type RiskSettings,
  type SmartWalletItem,
} from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { colors, common, spacing } from '../theme';

export function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [risk, setRisk] = useState<RiskSettings | null>(null);
  const [wallets, setWallets] = useState<{
    verified: SmartWalletItem[];
    user: SmartWalletItem[];
  }>({ verified: [], user: [] });
  const [walletAddr, setWalletAddr] = useState('');
  const [walletLabel, setWalletLabel] = useState('');
  const [notes, setNotes] = useState<Array<{ id: string; label: string }>>([]);
  const [notifStatus, setNotifStatus] = useState<Awaited<
    ReturnType<typeof fetchNotificationStatus>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r, n, st, w] = await Promise.all([
        fetchSettings(),
        fetchRiskSettings(),
        fetchNotifications(10),
        fetchNotificationStatus().catch(() => null),
        fetchSmartWallets().catch(() => ({ verified: [], user: [], all: [] })),
      ]);
      setSettings(s);
      setRisk(r);
      setWallets({ verified: w.verified, user: w.user });
      setNotes(
        n.items.map((i) => ({
          id: i.id,
          label: `${i.title} · ${i.sentAt.slice(11, 19)}`,
        })),
      );
      setNotifStatus(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !settings) {
    return (
      <View style={common.screen}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={common.screen}
      refreshControl={<RefreshControl refreshing={loading || busy} onRefresh={load} tintColor={colors.accent} />}
    >
      <Text style={common.title}>Settings</Text>
      <Text style={common.subtitle}>
        Configure risk filters and notifications. Auto trading stays off. Not financial advice.
      </Text>

      {error ? (
        <View style={common.card}>
          <StatusBadge label="SETTINGS ERROR" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}

      <View style={common.card}>
        <StatusBadge label={settings?.tradingMode ?? 'SIGNAL_ONLY'} tone="info" />
        <Text style={common.cardTitle}>App</Text>
        <Row
          label="Beginner mode"
          value={!!settings?.beginnerMode}
          onChange={(v) => void run(() => updateSettings({ beginnerMode: v }))}
        />
        <Row
          label="Notify BUY setups"
          value={!!settings?.notifyBuySetups}
          onChange={(v) => void run(() => updateSettings({ notifyBuySetups: v }))}
        />
        <Row
          label="Notify FX BUY/SELL"
          value={settings?.notifyFxSetups !== false}
          onChange={(v) => void run(() => updateSettings({ notifyFxSetups: v }))}
        />
        <Row
          label="Notify paper exits"
          value={!!settings?.notifyPaperExits}
          onChange={(v) => void run(() => updateSettings({ notifyPaperExits: v }))}
        />
        <Row
          label="Notify real trade approvals"
          value={!!settings?.notifyRealTrades}
          onChange={(v) => void run(() => updateSettings({ notifyRealTrades: v }))}
        />
        <Row
          label="Telegram enabled"
          value={!!settings?.telegramEnabled}
          onChange={(v) => void run(() => updateSettings({ telegramEnabled: v }))}
        />
        <Row
          label="WhatsApp enabled"
          value={!!settings?.whatsappEnabled}
          onChange={(v) => void run(() => updateSettings({ whatsappEnabled: v }))}
        />
        <Row
          label="Email enabled"
          value={!!settings?.emailEnabled}
          onChange={(v) => void run(() => updateSettings({ emailEnabled: v }))}
        />
        <Text style={[common.cardBody, { marginTop: 6, color: colors.accent }]}>
          {settings?.telegramEnabled
            ? 'Telegram ON — BUY setups go to Telegram as soon as the bot confirms them.'
            : 'Telegram muted. Turn this ON (and keep TELEGRAM_* in .env) to get BUY alerts.'}
        </Text>
        <Text style={[common.cardBody, { marginTop: 4, color: colors.accent }]}>
          {settings?.whatsappEnabled
            ? 'WhatsApp ON — needs WHATSAPP_* in .env (Meta or Twilio).'
            : 'WhatsApp off until you add Meta/Twilio keys and enable this toggle.'}
        </Text>
        <Text style={[common.cardBody, { marginTop: 4, color: colors.accent }]}>
          {settings?.emailEnabled
            ? `Gmail/email ON — BUY setups go to ${notifStatus?.email?.to ?? 'ALERT_EMAIL'}.`
            : 'Email muted. Add Gmail SMTP in .env, then enable this toggle.'}
        </Text>
        <Text style={[common.cardBody, { marginTop: 8 }]}>
          Seeing BUY in the app without a ping? Keep Notify BUY setups ON plus Telegram
          and Email. Alerts send immediately (not only after you open the coin).
        </Text>
        <Text style={[common.cardBody, { marginTop: 8 }]}>
          Kill switch: {settings?.killSwitch ? 'ON' : 'OFF'} · Emergency:{' '}
          {settings?.emergencyStop ? 'ON' : 'OFF'} · Auto always OFF via settings
        </Text>
      </View>

      <View style={common.card}>
        <Text style={common.cardTitle}>Alerts & queues</Text>
        <Text style={common.cardBody}>
          Telegram: {notifStatus?.telegram?.status ?? '…'}
          {notifStatus?.telegram?.botUsername
            ? ` (@${notifStatus.telegram.botUsername})`
            : ''}
          {notifStatus?.telegramConfigured ? ' · configured' : ' · set TELEGRAM_* in .env'}
        </Text>
        {notifStatus?.telegram?.message ? (
          <Text style={[common.cardBody, { marginTop: 4 }]}>
            {notifStatus.telegram.message}
          </Text>
        ) : null}
        <Text style={[common.cardBody, { marginTop: 8 }]}>
          WhatsApp: {notifStatus?.whatsapp?.status ?? '…'}
          {notifStatus?.whatsapp?.provider ? ` (${notifStatus.whatsapp.provider})` : ''}
          {notifStatus?.whatsappConfigured ? ' · configured' : ' · set WHATSAPP_* in .env'}
        </Text>
        {notifStatus?.whatsapp?.message ? (
          <Text style={[common.cardBody, { marginTop: 4 }]}>
            {notifStatus.whatsapp.message}
          </Text>
        ) : null}
        <Text style={[common.cardBody, { marginTop: 8 }]}>
          Email: {notifStatus?.email?.status ?? '…'}
          {notifStatus?.emailConfigured ? ' · configured' : ' · set SMTP_* + ALERT_EMAIL'}
        </Text>
        {notifStatus?.email?.message ? (
          <Text style={[common.cardBody, { marginTop: 4 }]}>
            {notifStatus.email.message}
          </Text>
        ) : null}
        <Text style={[common.cardBody, { marginTop: 8 }]}>
          Redis queue: {notifStatus?.redis?.status ?? '…'}
          {notifStatus?.redis?.message ? ` — ${notifStatus.redis.message}` : ''}
        </Text>
        <Text style={[common.cardBody, { marginTop: 8 }]}>
          Setup help: GET /api/notifications/email/setup (Gmail app password)
        </Text>
      </View>

      <View style={common.card}>
        <Text style={common.cardTitle}>Risk thresholds</Text>
        <NumField
          label="Safety min"
          value={risk?.safetyMin}
          onSubmit={(n) => void run(() => updateRiskSettings({ safetyMin: n }))}
        />
        <NumField
          label="Signal min"
          value={risk?.signalMin}
          onSubmit={(n) => void run(() => updateRiskSettings({ signalMin: n }))}
        />
        <NumField
          label="Risk per trade %"
          value={risk?.riskPerTradePct}
          onSubmit={(n) => void run(() => updateRiskSettings({ riskPerTradePct: n }))}
        />
        <NumField
          label="Min liquidity $"
          value={risk?.minLiquidityUsd}
          onSubmit={(n) => void run(() => updateRiskSettings({ minLiquidityUsd: n }))}
        />
        <NumField
          label="Min risk/reward (1:X)"
          value={risk?.minRiskReward}
          onSubmit={(n) => void run(() => updateRiskSettings({ minRiskReward: n }))}
        />
        <NumField
          label="TP1 %"
          value={risk?.tp1Pct}
          onSubmit={(n) => void run(() => updateRiskSettings({ tp1Pct: n }))}
        />
        <NumField
          label="TP2 %"
          value={risk?.tp2Pct}
          onSubmit={(n) => void run(() => updateRiskSettings({ tp2Pct: n }))}
        />
      </View>

      <View style={common.card}>
        <Text style={common.cardTitle}>Smart money wallets</Text>
        <Text style={common.cardBody}>
          High-quality wallets are discovered automatically from on-chain meme-coin trades. Optional
          addresses you add here are extra inputs only — a wallet holding a token is never an
          automatic BUY. Never paste a private key.
        </Text>
        {wallets.verified.length === 0 && wallets.user.length === 0 ? (
          <Text style={[common.cardBody, { marginTop: 8, color: colors.warn }]}>
            None tracked yet — discovery still fills the Smart money dashboard on its own.
            You can add extra public wallets here if you want.
          </Text>
        ) : null}
        {[...wallets.verified, ...wallets.user].map((w) => (
          <View key={`${w.origin}-${w.address}`} style={[common.row, { marginTop: 10 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[common.cardBody, { color: colors.text }]}>
                {w.label} · {w.origin === 'VERIFIED' ? 'verified' : 'you added'}
              </Text>
              <Text style={common.cardBody}>
                {w.address.slice(0, 4)}…{w.address.slice(-4)}
              </Text>
            </View>
            {w.origin === 'USER' ? (
              <Pressable
                onPress={() => void run(() => removeSmartWallet(w.address))}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: colors.danger,
                }}
              >
                <Text style={{ color: colors.danger, fontWeight: '700' }}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        <Text style={[common.cardBody, { marginTop: 12 }]}>Add wallet (public key)</Text>
        <TextInput
          value={walletAddr}
          onChangeText={setWalletAddr}
          placeholder="Solana address"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            marginTop: 4,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
            color: colors.text,
            paddingHorizontal: 10,
            paddingVertical: 8,
            backgroundColor: colors.bg,
          }}
        />
        <TextInput
          value={walletLabel}
          onChangeText={setWalletLabel}
          placeholder="Label (optional)"
          placeholderTextColor={colors.muted}
          style={{
            marginTop: 8,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
            color: colors.text,
            paddingHorizontal: 10,
            paddingVertical: 8,
            backgroundColor: colors.bg,
          }}
        />
        <Pressable
          onPress={() =>
            void run(async () => {
              await addSmartWallet(walletAddr, walletLabel || undefined);
              setWalletAddr('');
              setWalletLabel('');
            })
          }
          style={[common.secondaryBtn, { marginTop: 8 }]}
        >
          <Text style={common.secondaryBtnText}>Add smart money wallet</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm }}>
        <Pressable
          onPress={() => void run(() => sendTestNotification())}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.accent,
            backgroundColor: colors.accent + '22',
          }}
        >
          <Text style={{ color: colors.accent }}>Send test notification</Text>
        </Pressable>
        <Pressable
          onPress={() => void run(() => resetSettings())}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <Text style={{ color: colors.warn }}>Reset defaults</Text>
        </Pressable>
      </View>

      <View style={common.card}>
        <Text style={common.cardTitle}>Recent notifications</Text>
        {notes.length === 0 ? (
          <Text style={common.cardBody}>None yet.</Text>
        ) : (
          notes.map((n) => (
            <Text key={n.id} style={common.cardBody}>
              {n.label}
            </Text>
          ))
        )}
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function Row({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 8,
      }}
    >
      <Text style={common.cardBody}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

function NumField({
  label,
  value,
  onSubmit,
}: {
  label: string;
  value?: number;
  onSubmit: (n: number) => void;
}) {
  const [text, setText] = useState(value != null ? String(value) : '');
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={common.cardBody}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          keyboardType="decimal-pad"
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
            color: colors.text,
            paddingHorizontal: 10,
            paddingVertical: 8,
            backgroundColor: colors.bg,
          }}
        />
        <Pressable
          onPress={() => {
            const n = Number(text);
            if (Number.isFinite(n)) onSubmit(n);
          }}
          style={{
            paddingHorizontal: 12,
            justifyContent: 'center',
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ color: colors.info }}>Save</Text>
        </Pressable>
      </View>
    </View>
  );
}
