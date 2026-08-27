import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { AppLogo } from '../components/AppLogo';
import { StatusBadge } from '../components/StatusBadge';
import { colors, common, spacing } from '../theme';

export function LoginScreen() {
  const { login, register, loginWithGoogle, loginWithApple, providers } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Auth failed';
      if (msg.toLowerCase().includes('cancel')) return;
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: spacing.md,
          paddingBottom: 48,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={{ alignItems: 'center', marginBottom: spacing.sm }}>
          <AppLogo size={108} showWordmark />
        </View>
        <Text style={[common.subtitle, { textAlign: 'center' }]}>
          Google, Apple, or email. If Google fails, use email below.
        </Text>

        {error ? (
          <View style={common.card}>
            <StatusBadge label="AUTH ERROR" tone="danger" />
            <Text style={common.cardBody}>{error}</Text>
          </View>
        ) : null}

        <View style={common.card}>
          <Text style={common.cardTitle}>
            {mode === 'register' ? 'Create account' : 'Log in'}
          </Text>

          <Pressable
            style={[
              socialBtn,
              {
                borderColor: providers.google ? '#EA4335' : colors.border,
                opacity: providers.google ? 1 : 0.55,
                marginTop: spacing.sm,
              },
            ]}
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await loginWithGoogle();
              })
            }
          >
            <Ionicons
              name="logo-google"
              size={20}
              color={providers.google ? '#EA4335' : colors.muted}
            />
            <Text style={[socialText, !providers.google && { color: colors.muted }]}>
              {providers.google ? 'Continue with Google' : 'Google (not configured)'}
            </Text>
          </Pressable>

          {Platform.OS === 'ios' ? (
            <Pressable
              style={[socialBtn, { borderColor: colors.text }]}
              disabled={busy}
              onPress={() => void run(() => loginWithApple())}
            >
              <Ionicons name="logo-apple" size={20} color={colors.text} />
              <Text style={socialText}>Continue with Apple</Text>
            </Pressable>
          ) : (
            <Text style={[common.cardBody, { marginTop: spacing.sm }]}>
              Apple Sign In is only on iPhone.
            </Text>
          )}

          <Text
            style={[
              common.cardBody,
              { textAlign: 'center', marginVertical: spacing.md, fontWeight: '700' },
            ]}
          >
            Recommended now: email
          </Text>

          {mode === 'register' ? (
            <>
              <Text style={common.metricLabel}>Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                style={input}
                placeholderTextColor={colors.muted}
                placeholder="Your name"
                returnKeyType="next"
              />
            </>
          ) : null}
          <Text style={[common.metricLabel, { marginTop: spacing.sm }]}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            style={input}
            placeholderTextColor={colors.muted}
            placeholder="you@example.com"
            returnKeyType="next"
            autoCorrect={false}
          />
          <Text style={[common.metricLabel, { marginTop: spacing.sm }]}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={input}
            placeholderTextColor={colors.muted}
            placeholder="Min 6 characters"
            returnKeyType="done"
            onSubmitEditing={() =>
              void run(async () => {
                if (mode === 'login') await login(email.trim(), password);
                else await register(name.trim(), email.trim(), password);
              })
            }
          />

          <Pressable
            style={[common.primaryBtn, { marginTop: spacing.md }]}
            onPress={() =>
              void run(async () => {
                if (mode === 'login') await login(email.trim(), password);
                else await register(name.trim(), email.trim(), password);
              })
            }
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#04140E" />
            ) : (
              <Text style={common.primaryBtnText}>
                {mode === 'login' ? 'Log in with email' : 'Create account with email'}
              </Text>
            )}
          </Pressable>

          <Pressable
            style={{ marginTop: spacing.md }}
            onPress={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            <Text style={{ color: colors.info, textAlign: 'center', fontWeight: '600' }}>
              {mode === 'login'
                ? 'Need an account? Create one'
                : 'Already have an account? Log in'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const input = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 10,
  color: colors.text,
  paddingHorizontal: 12,
  paddingVertical: 12,
  backgroundColor: colors.bg,
  marginTop: 4,
  fontSize: 16,
} as const;

const socialBtn = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  gap: 10,
  borderWidth: 1,
  borderRadius: 10,
  paddingVertical: 12,
  marginTop: spacing.sm,
  backgroundColor: colors.bg,
};

const socialText = {
  color: colors.text,
  fontWeight: '700' as const,
  fontSize: 15,
};
