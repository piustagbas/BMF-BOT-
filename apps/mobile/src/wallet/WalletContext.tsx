import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';
import {
  connectSwapWallet,
  disconnectSwapWallet,
  fetchSwapWallet,
} from '../api/client';
import {
  connectWalletUrl,
  createDappKeyPair,
  decryptWalletPayload,
  parseWalletCallback,
  signAndSendUrl,
  type WalletProviderName,
} from './phantom';

type Session = {
  address: string;
  provider: WalletProviderName | 'manual';
  session?: string;
  theirPublicKey?: string;
  secretKeyB64?: string;
  publicKeyB64?: string;
};

type Pending =
  | { kind: 'connect'; resolve: (s: Session) => void; reject: (e: Error) => void }
  | { kind: 'sign'; resolve: (sig: string) => void; reject: (e: Error) => void };

type WalletContextValue = {
  address: string | null;
  provider: Session['provider'] | null;
  connected: boolean;
  connecting: boolean;
  solBalance: number;
  solBalanceUsd: number;
  connect: (provider: WalletProviderName | 'manual', manualAddress?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  signAndSend: (txBase64: string) => Promise<string>;
  refresh: () => Promise<void>;
};

const KEY = 'swap_wallet_session';
const WalletContext = createContext<WalletContextValue | null>(null);

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
function unb64(s: string): Uint8Array {
  const buf = Buffer.from(s, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [solBalance, setSolBalance] = useState(0);
  const [solBalanceUsd, setSolBalanceUsd] = useState(0);
  const pending = useRef<Pending | null>(null);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  const persist = useCallback(async (next: Session | null) => {
    setSession(next);
    if (next) await AsyncStorage.setItem(KEY, JSON.stringify(next));
    else await AsyncStorage.removeItem(KEY);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const w = await fetchSwapWallet();
      setSolBalance(w.solBalance ?? 0);
      setSolBalanceUsd(w.solBalanceUsd ?? 0);
      if (w.connected && w.address && !sessionRef.current) {
        await persist({ address: w.address, provider: (w.provider as Session['provider']) || 'manual' });
      }
    } catch {
      /* offline */
    }
  }, [persist]);

  const handleUrl = useCallback(
    (url: string) => {
      if (!url.includes('wallet')) return;
      const parsed = parseWalletCallback(url);
      const p = pending.current;
      if (!p) return;
      if (parsed.error) {
        p.reject(new Error(parsed.error));
        pending.current = null;
        return;
      }
      const cur = sessionRef.current;
      const secret = cur?.secretKeyB64 ? unb64(cur.secretKeyB64) : null;
      if (!parsed.data || !parsed.nonce || !parsed.phantomEncryptionPublicKey || !secret) {
        p.reject(new Error('Wallet response was incomplete'));
        pending.current = null;
        return;
      }
      try {
        const payload = decryptWalletPayload(
          parsed.data,
          parsed.nonce,
          parsed.phantomEncryptionPublicKey,
          secret,
        );
        if (p.kind === 'connect') {
          const address = String(payload.public_key ?? payload.publicKey ?? '');
          if (!address) throw new Error('Wallet did not return an address');
          const next: Session = {
            address,
            provider: cur?.provider === 'solflare' ? 'solflare' : 'phantom',
            session: typeof payload.session === 'string' ? payload.session : undefined,
            theirPublicKey: parsed.phantomEncryptionPublicKey,
            secretKeyB64: cur?.secretKeyB64,
            publicKeyB64: cur?.publicKeyB64,
          };
          p.resolve(next);
        } else {
          const sig = String(payload.signature ?? '');
          if (!sig) throw new Error('Wallet did not return a signature');
          p.resolve(sig);
        }
      } catch (err) {
        p.reject(err instanceof Error ? err : new Error('Wallet decrypt failed'));
      } finally {
        pending.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        try {
          setSession(JSON.parse(raw) as Session);
        } catch {
          /* ignore */
        }
      }
      await refresh();
    })();
    const sub = Linking.addEventListener('url', (e) => handleUrl(e.url));
    void Linking.getInitialURL().then((u) => {
      if (u) handleUrl(u);
    });
    return () => sub.remove();
  }, [handleUrl, refresh]);

  const connect = useCallback(
    async (provider: WalletProviderName | 'manual', manualAddress?: string) => {
      if (provider === 'manual') {
        const address = manualAddress?.trim();
        if (!address) throw new Error('Enter a Solana public address');
        await connectSwapWallet(address, 'manual');
        await persist({ address, provider: 'manual' });
        await refresh();
        Alert.alert(
          'Connected successfully',
          `Public address saved.\n\n${address.slice(0, 4)}…${address.slice(-4)}\n\nThis view cannot sign trades. Connect Phantom or Solflare to buy or sell.`,
        );
        return;
      }
      setConnecting(true);
      try {
        const kp = await createDappKeyPair();
        const draft: Session = {
          address: '',
          provider,
          secretKeyB64: b64(kp.secretKey),
          publicKeyB64: b64(kp.publicKey),
        };
        await persist(draft);
        const connected = await new Promise<Session>((resolve, reject) => {
          pending.current = { kind: 'connect', resolve, reject };
          const url = connectWalletUrl(provider, kp.publicKey);
          void Linking.openURL(url).catch((err) =>
            reject(err instanceof Error ? err : new Error('Could not open wallet')),
          );
        });
        await connectSwapWallet(connected.address, provider);
        await persist(connected);
        await refresh();
        const name = provider === 'solflare' ? 'Solflare' : 'Phantom';
        Alert.alert(
          'Connected successfully',
          `${name} is connected.\n\n${connected.address.slice(0, 4)}…${connected.address.slice(-4)}\n\nThis app never asked for a seed phrase. You can review a buy or sell now.`,
        );
      } catch (err) {
        Alert.alert(
          'Could not connect',
          err instanceof Error ? err.message : 'Wallet connect failed. Try Phantom or Solflare again.',
        );
        throw err;
      } finally {
        setConnecting(false);
      }
    },
    [persist, refresh],
  );

  const disconnect = useCallback(async () => {
    await disconnectSwapWallet().catch(() => undefined);
    await persist(null);
    setSolBalance(0);
    setSolBalanceUsd(0);
  }, [persist]);

  const signAndSend = useCallback(async (txBase64: string) => {
    const cur = sessionRef.current;
    if (!cur?.address) throw new Error('Connect a wallet before trading.');
    if (cur.provider === 'manual' || !cur.session || !cur.theirPublicKey || !cur.secretKeyB64 || !cur.publicKeyB64) {
      throw new Error('Open Phantom or Solflare to sign this trade. Manual address view cannot sign.');
    }
    return new Promise<string>((resolve, reject) => {
      pending.current = { kind: 'sign', resolve, reject };
      void (async () => {
        try {
          const url = await signAndSendUrl(
            cur.provider === 'solflare' ? 'solflare' : 'phantom',
            txBase64,
            cur.session!,
            unb64(cur.publicKeyB64!),
            cur.theirPublicKey!,
            unb64(cur.secretKeyB64!),
          );
          const opened = await Linking.openURL(url);
          if (!opened) throw new Error('Could not open wallet');
        } catch (err) {
          pending.current = null;
          reject(err instanceof Error ? err : new Error('Wallet sign failed'));
        }
      })();
    });
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      address: session?.address || null,
      provider: session?.provider ?? null,
      connected: Boolean(session?.address),
      connecting,
      solBalance,
      solBalanceUsd,
      connect,
      disconnect,
      signAndSend,
      refresh,
    }),
    [session, connecting, solBalance, solBalanceUsd, connect, disconnect, signAndSend, refresh],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    Alert.alert('Wallet', 'Wallet provider is missing');
    return {
      address: null,
      provider: null,
      connected: false,
      connecting: false,
      solBalance: 0,
      solBalanceUsd: 0,
      connect: async () => undefined,
      disconnect: async () => undefined,
      signAndSend: async () => {
        throw new Error('Wallet unavailable');
      },
      refresh: async () => undefined,
    };
  }
  return ctx;
}
