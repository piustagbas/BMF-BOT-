import type { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Tabs: undefined;
  TokenDetails: { address: string };
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
  ForexHome: undefined;
  ForexSignal: { id: string; side: 'BUY' | 'SELL' };
};
