import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  appleLoginRequest,
  fetchAuthProviders,
  fetchProfile,
  googleAuthUrl,
  isUnauthorizedError,
  loginRequest,
  registerRequest,
  setAuthToken,
  type AuthUser,
} from '../api/client';

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  providers: { email: boolean; google: boolean; apple: boolean };
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithApple: () => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

function authRedirectUri(): string {
  const expoConfig = Constants.expoConfig as { hostUri?: string } | null;
  const hostUri =
    expoConfig?.hostUri ||
    (Constants as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost ||
    (
      Constants as {
        manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } };
      }
    ).manifest2?.extra?.expoGo?.debuggerHost;
  if (typeof hostUri === 'string' && hostUri.length > 0) {
    return `exp://${hostUri}/--/auth/callback`;
  }
  return 'memecoinbot://auth/callback';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState({
    email: true,
    google: true,
    apple: Platform.OS === 'ios',
  });

  const applySession = useCallback(async (nextToken: string, nextUser: AuthUser) => {
    setAuthToken(nextToken);
    setToken(nextToken);
    setUser(nextUser);
    await AsyncStorage.setItem(TOKEN_KEY, nextToken);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(nextUser));
  }, []);

  const clearSession = useCallback(async () => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const caps = await fetchAuthProviders().catch(() => null);
        if (caps) {
          setProviders({
            email: true,
            google: caps.google,
            apple: Platform.OS === 'ios' ? true : caps.apple,
          });
        }
        const [storedToken, storedUser] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
        ]);
        if (!storedToken) return;
        setAuthToken(storedToken);
        setToken(storedToken);
        if (storedUser) {
          try {
            setUser(JSON.parse(storedUser) as AuthUser);
          } catch {
            /* ignore */
          }
        }
        const profile = await fetchProfile();
        setUser(profile);
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(profile));
      } catch (e) {
        if (isUnauthorizedError(e)) {
          await clearSession();
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [clearSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await loginRequest(email, password);
      await applySession(res.token, res.data.user);
    },
    [applySession],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const res = await registerRequest(name, email, password);
      await applySession(res.token, res.data.user);
    },
    [applySession],
  );

  const loginWithGoogle = useCallback(async () => {
    let WebBrowser: typeof import('expo-web-browser');
    try {
      WebBrowser = await import('expo-web-browser');
    } catch {
      throw new Error(
        'Google sign-in package missing. Restart Expo with --clear, or use email login.',
      );
    }
    WebBrowser.maybeCompleteAuthSession();
    try {
      await fetchAuthProviders();
    } catch {
      throw new Error(
        'Cannot reach the server. Start the API, then try Google again.',
      );
    }
    const returnUrl = authRedirectUri();
    const authUrl = googleAuthUrl(returnUrl);
    const result = await WebBrowser.openAuthSessionAsync(authUrl, returnUrl);
    if (result.type !== 'success' || !('url' in result) || !result.url) {
      return;
    }
    const callbackUrl = new URL(result.url);
    const err = callbackUrl.searchParams.get('error');
    if (err) throw new Error(err);
    const nextToken = callbackUrl.searchParams.get('token');
    if (!nextToken) throw new Error('No authentication token returned');
    setAuthToken(nextToken);
    const profile = await fetchProfile();
    await applySession(nextToken, profile);
  }, [applySession]);

  const loginWithApple = useCallback(async () => {
    if (Platform.OS !== 'ios') {
      throw new Error('Apple Sign In is only available on iPhone/iPad');
    }
    let AppleAuthentication: typeof import('expo-apple-authentication');
    try {
      AppleAuthentication = await import('expo-apple-authentication');
    } catch {
      throw new Error(
        'Apple sign-in package missing. Restart Expo with --clear, or use email login.',
      );
    }
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      throw new Error('No identity token returned from Apple');
    }
    const res = await appleLoginRequest(credential.identityToken, {
      fullName: credential.fullName ?? undefined,
      email: credential.email,
    });
    await applySession(res.token, res.data.user);
  }, [applySession]);

  const refreshProfile = useCallback(async () => {
    const profile = await fetchProfile();
    setUser(profile);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(profile));
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      isAuthenticated: Boolean(token && user),
      providers,
      login,
      register,
      loginWithGoogle,
      loginWithApple,
      logout: clearSession,
      refreshProfile,
    }),
    [
      user,
      token,
      loading,
      providers,
      login,
      register,
      loginWithGoogle,
      loginWithApple,
      clearSession,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
