import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { fetchAutoTradingStatus, updateSettings } from '../api/client';
import { useAuth } from '../auth/AuthContext';

type MemecoinAutoTradeContextValue = {
  addresses: string[];
  refresh: () => Promise<void>;
  toggle: (address: string, enabled: boolean) => Promise<void>;
};

const MemecoinAutoTradeContext =
  createContext<MemecoinAutoTradeContextValue | null>(null);

export function MemecoinAutoTradeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated } = useAuth();
  const [addresses, setAddresses] = useState<string[]>([]);
  const addressesRef = useRef<string[]>([]);
  const pendingWrites = useRef(0);

  const setCurrentAddresses = useCallback((next: string[]) => {
    addressesRef.current = next;
    setAddresses(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!isAuthenticated || pendingWrites.current > 0) return;
    const status = await fetchAutoTradingStatus();
    if (pendingWrites.current === 0) {
      setCurrentAddresses(status.autoTradeMemecoinAddresses ?? []);
    }
  }, [isAuthenticated, setCurrentAddresses]);

  useEffect(() => {
    if (!isAuthenticated) {
      pendingWrites.current = 0;
      setCurrentAddresses([]);
      return;
    }
    void refresh().catch(() => undefined);
  }, [isAuthenticated, refresh, setCurrentAddresses]);

  const toggle = useCallback(
    async (address: string, enabled: boolean) => {
      const previous = addressesRef.current;
      const next = enabled
        ? [...new Set([...previous, address])]
        : previous.filter((item) => item !== address);
      setCurrentAddresses(next);
      pendingWrites.current += 1;

      try {
        const saved = await updateSettings({
          autoTradeMemecoinAddresses: next,
          autoTradeMemecoins: next.length > 0,
        });
        if (pendingWrites.current === 1) {
          setCurrentAddresses(saved.autoTradeMemecoinAddresses ?? next);
        }
      } catch (error) {
        const current = addressesRef.current;
        const currentEnabled = current.includes(address);
        if (currentEnabled === enabled) {
          const restored = enabled
            ? current.filter((item) => item !== address)
            : [...new Set([...current, address])];
          setCurrentAddresses(restored);
        }
        throw error;
      } finally {
        pendingWrites.current = Math.max(0, pendingWrites.current - 1);
      }
    },
    [setCurrentAddresses],
  );

  return (
    <MemecoinAutoTradeContext.Provider value={{ addresses, refresh, toggle }}>
      {children}
    </MemecoinAutoTradeContext.Provider>
  );
}

export function useMemecoinAutoTrade() {
  const context = useContext(MemecoinAutoTradeContext);
  if (!context) {
    throw new Error(
      'useMemecoinAutoTrade must be used within MemecoinAutoTradeProvider',
    );
  }
  return context;
}
