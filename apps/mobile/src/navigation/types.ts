import type { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Tabs: undefined;
  TokenDetails: { address: string; action?: 'BUY' | 'SELL' };
  Notifications: undefined;
  Portfolio: undefined;
  TradeHistory: undefined;
  BetBot: NavigatorScreenParams<BetBotStackParamList> | undefined;
  ForexBot: NavigatorScreenParams<ForexBotStackParamList> | undefined;
};

export type MoreStackParamList = {
  MoreHome: undefined;
  Paper: undefined;
  Trade: undefined;
  Backtest: undefined;
  Outcomes: undefined;
  Settings: undefined;
  SmartMoney: undefined;
};

export type BetBotStackParamList = {
  BetHome: undefined;
  BetFixture: { id: string };
  BetSlip: undefined;
  BetVerify: undefined;
};

export type ForexBotStackParamList = {
  ForexHome: { tab?: 'SETUPS' | 'OPEN' | 'JOURNAL' | 'RISK' | 'LAB'; notice?: string } | undefined;
  ForexSignal: { symbol: string; id?: string; side?: 'BUY' | 'SELL' };
};
