import { API_BASE_URL } from '../config';

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken() {
  return authToken;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function isUnauthorizedError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  isVerified?: boolean;
  authProvider?: string;
  createdAt?: string;
};

type AuthResponse = {
  status: string;
  token: string;
  data: { user: AuthUser };
};

function friendlyHttpError(status: number, text: string): string {
  const looksHtml = /^\s*</.test(text) || /ngrok|cloudflare|captcha/i.test(text);
  if (looksHtml || status === 502 || status === 503 || status === 504) {
    return 'Cannot reach the server. Make sure the API is running, then pull to refresh.';
  }
  return `Request failed (${status})`;
}

async function apiFetch(input: string, init?: RequestInit, timeoutMs = 20000): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('ngrok-skip-browser-warning', '1');
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, headers, signal: controller.signal });
  } catch (err) {
    const aborted =
      (err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))) ||
      false;
    throw new ApiError(
      aborted
        ? 'Server took too long. Pull to refresh.'
        : 'Cannot reach the server. Check your connection and that the API is running.',
      aborted ? 408 : 0,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join(', ');
    if (typeof body.message === 'string' && body.message.trim()) return body.message;
  } catch {
    /* html / empty */
  }
  return friendlyHttpError(res.status, text);
}

export async function registerRequest(
  name: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  const res = await apiFetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<AuthResponse>;
}

export async function loginRequest(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const res = await apiFetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<AuthResponse>;
}

export async function fetchProfile(): Promise<AuthUser> {
  const res = await apiFetch(`${API_BASE_URL}/user/profile`);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  const json = (await res.json()) as { data: { user: AuthUser } };
  return json.data.user;
}

export async function fetchAuthProviders() {
  const res = await apiFetch(`${API_BASE_URL}/auth/providers`);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{
    email: boolean;
    google: boolean;
    apple: boolean;
    note?: string;
  }>;
}

export function googleAuthUrl(callbackUrl: string) {
  return `${API_BASE_URL}/auth/google?callback=${encodeURIComponent(callbackUrl)}`;
}

export async function appleLoginRequest(
  identityToken: string,
  user?: {
    fullName?: { givenName?: string | null; familyName?: string | null };
    email?: string | null;
  },
): Promise<AuthResponse> {
  const res = await apiFetch(`${API_BASE_URL}/auth/apple`, {
    method: 'POST',
    body: JSON.stringify({ identityToken, user }),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<AuthResponse>;
}

export type HealthPayload = {
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  version: string;
  tradingMode: string;
  autoTradingEnabled: boolean;
  killSwitch: boolean;
  timestamp: string;
  sources: Record<string, { status: string; message?: string }>;
};

export type AutoTradingStatus = {
  tradingMode: string;
  autoTradingEnabled: boolean;
  killSwitch: boolean;
  emergencyStop: boolean;
  walletPublicKey: string | null;
  realTradingBroadcast: boolean;
  axiomRequiredForAutoTrading?: boolean;
  executionMode?: string;
  label: string;
  killSwitchLabel: string;
  warning?: string | null;
  canExecuteRealTrades: boolean;
  canPrepareManualTrade?: boolean;
  canRunAutoCycle?: boolean;
  reason: string;
};

export async function fetchHealth(): Promise<HealthPayload> {
  const res = await apiFetch(`${API_BASE_URL}/health`);
  if (!res.ok) {
    throw new ApiError(await readError(res), res.status);
  }
  return res.json() as Promise<HealthPayload>;
}

export async function fetchAutoTradingStatus(): Promise<AutoTradingStatus> {
  const res = await apiFetch(`${API_BASE_URL}/auto-trading/status`);
  if (!res.ok) {
    throw new ApiError(await readError(res), res.status);
  }
  return res.json() as Promise<AutoTradingStatus>;
}

export type ScannerToken = {
  address: string;
  name: string;
  symbol: string;
  imageUrl?: string | null;
  priceUsd: number | null;
  marketCap: number | null;
  fdv: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  priceChange24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  pairAgeHours: number | null;
  dexId: string | null;
  pairAddress: string | null;
  source: string;
  fetchedAt: string;
  axiomUnavailable: boolean;
  axiomScore: number | null;
  jupiterPriceUsd: number | null;
  dataConflict: boolean;
  conflictReason?: string;
  safetyScore: number | null;
  safetyDecision: 'POTENTIAL_SETUP' | 'NO_TRADE' | null;
  signalType?: 'WATCH' | 'SETUP_FORMING' | 'NO_TRADE' | 'BUY' | null;
  criticalWarning: boolean;
  holderRisk: string | null;
  whaleActivity: string | null;
  safetySummary: string | null;
  feedSources?: string;
};

export async function fetchTokens(params?: {
  sort?: string;
  limit?: number;
  q?: string;
}): Promise<{ items: ScannerToken[]; source: string; count: number; note?: string }> {
  const sp = new URLSearchParams();
  if (params?.sort) sp.set('sort', params.sort);
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.q) sp.set('q', params.q);
  const qs = sp.toString();
  const url = `${API_BASE_URL}/tokens${qs ? `?${qs}` : ''}`;
  let res: Response;
  try {
    res = await apiFetch(url);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 0 || err.status === 408)) {
      res = await apiFetch(url);
    } else {
      throw err;
    }
  }
  if (!res.ok && (res.status === 502 || res.status === 503)) {
    await new Promise((r) => setTimeout(r, 700));
    res = await apiFetch(url);
  }
  if (!res.ok) {
    throw new ApiError(await readError(res), res.status);
  }
  return res.json() as Promise<{
    items: ScannerToken[];
    source: string;
    count: number;
    note?: string;
  }>;
}

export type TokenSafety = {
  safetyScore: number;
  decision: string;
  criticalWarning: boolean;
  holderRisk: string;
  whaleActivity: string;
  summary: string;
  beginner: {
    whatBotSees: string[];
    whatCouldGoWrong: string[];
    decision: string;
  };
  risks: Array<{ name: string; level: string }>;
  top10Pct: number | null;
  top20Pct: number | null;
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
};

export async function fetchTokenSafety(address: string): Promise<TokenSafety> {
  const res = await apiFetch(`${API_BASE_URL}/tokens/${address}/safety`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Safety failed (${res.status}): ${body.slice(0, 160)}`);
  }
  return res.json();
}

export type SignalItem = {
  token: {
    address: string;
    name: string;
    symbol: string;
    imageUrl?: string | null;
    priceUsd: number | null;
    liquidityUsd: number | null;
    volume24h: number | null;
    pairAddress?: string | null;
    pairAgeHours?: number | null;
    source?: string;
    jupiterPriceUsd?: number | null;
  };
  signalType: string;
  safetyScore: number;
  signalScore: number;
  buyScore?: number;
  axiomUnavailable?: boolean;
  criticalWarning?: boolean;
  strategy: { name: string; reason: string } | null;
  levels: {
    entryMin: number;
    entryMax: number;
    stopLoss: number;
    stopLossPct: number;
    tp1Pct: number;
    tp2Pct: number;
    riskReward: number;
    entryStatus: string;
  };
  failedChecks: string[];
  whyNotBuy?: {
    title: string;
    decision: string;
    buyScore: number;
    safetyScore: number;
    agreeing: number;
    required: number;
    available: number;
    summary: string;
    items: Array<{
      key: string;
      label: string;
      passed: boolean;
      blocking: boolean;
      status: 'PASS' | 'FAIL' | 'NEUTRAL';
      value: string;
      detail: string;
      whyItMatters: string;
    }>;
  };
  independent?: {
    agreeing: number;
    required: number;
    signals: Array<{ key: string; label: string; agrees: boolean; detail: string }>;
  };
  beginner: { decision: string };
  generatedAt: string;
  chart?: {
    primary: string;
    confirm: string;
    style: 'SCALP' | 'MINUTES' | 'HOURS';
    reason?: string;
    meaning?: string;
    instruction?: string;
    candleClosesAt?: string;
    confirmClosesAt?: string;
    entryWindowEndsAt?: string;
    waitForClose?: boolean;
  };
  memeScore?: {
    overall: number;
    level: string;
    smartMoney: number;
    liquidity: number;
    volume: number;
    holders: number;
    pressure: number;
    technical5m: number;
    trend15m: number;
    risk: number;
    independentWallets: number;
    tierA: number;
    tierB: number;
    reason: string;
    canEmitBuy: boolean;
  };
};

export async function fetchSignals(params?: {
  limit?: number;
  scan?: boolean;
}): Promise<{ items: SignalItem[]; count: number; mode: string }> {
  const sp = new URLSearchParams();
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.scan) sp.set('scan', '1');
  const qs = sp.toString();
  const res = await apiFetch(`${API_BASE_URL}/signals${qs ? `?${qs}` : ''}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Signals failed (${res.status}): ${body.slice(0, 160)}`);
  }
  return res.json() as Promise<{ items: SignalItem[]; count: number; mode: string }>;
}

export type PaperPosition = {
  id: string;
  symbol: string;
  status: string;
  entryPrice: number;
  stopLoss: number;
  tp1Price: number;
  tp2Price: number;
  sizeUsd: number;
  remainingPct: number;
  realizedPnlUsd: number;
  feesUsd: number;
  exitReason?: string;
  tp1Hit: boolean;
  tp2Hit: boolean;
};

export type PaperDashboard = {
  account: { balance: number; startingBalance: number; equity: number };
  performance: {
    currentBalance: number;
    equity: number;
    totalPnl: number;
    totalPnlPct: number;
    winRate: number;
    maxDrawdownPct: number;
    totalTrades: number;
    openPositions: number;
    tp1HitRate: number;
    tp2HitRate: number;
    slRate: number;
  };
  positions: { items: PaperPosition[]; count: number };
  trades: { items: PaperPosition[]; count: number };
};

export async function fetchPaperDashboard(): Promise<PaperDashboard> {
  const res = await apiFetch(`${API_BASE_URL}/paper/dashboard`);
  if (!res.ok) throw new Error(`Paper dashboard failed (${res.status})`);
  return res.json() as Promise<PaperDashboard>;
}

export async function openManualPaperTrade(body: {
  address: string;
  entryPrice?: number;
  stopLoss: number;
  tp1Price: number;
  tp2Price: number;
  symbol?: string;
}) {
  const res = await apiFetch(`${API_BASE_URL}/paper-trades/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function paperTestEvent(id: string, event: string) {
  const res = await apiFetch(`${API_BASE_URL}/paper-positions/${id}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function syncPaperPositions() {
  const res = await apiFetch(`${API_BASE_URL}/paper-positions/sync`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function resetPaperAccount(startingBalance = 1000) {
  const res = await apiFetch(`${API_BASE_URL}/paper-account/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startingBalance }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type BacktestItem = {
  id: string;
  address: string;
  warning: string;
  inSample: {
    signalsGenerated: number;
    entriesTaken: number;
    performance: {
      totalTrades: number;
      winRate: number;
      profitFactor: number;
      totalPnlPct: number;
      maxDrawdownPct: number;
    };
  };
  outOfSample: {
    signalsGenerated: number;
    entriesTaken: number;
    performance: {
      totalTrades: number;
      winRate: number;
      profitFactor: number;
      totalPnlPct: number;
      maxDrawdownPct: number;
    };
  };
  full: {
    signalsGenerated: number;
    entriesTaken: number;
    performance: {
      totalTrades: number;
      winRate: number;
      profitFactor: number;
      totalPnlPct: number;
      maxDrawdownPct: number;
    };
  };
};

export async function fetchBacktests(): Promise<{ items: BacktestItem[]; count: number }> {
  const res = await apiFetch(`${API_BASE_URL}/backtests`);
  if (!res.ok) throw new Error(`Backtests failed (${res.status})`);
  return res.json() as Promise<{ items: BacktestItem[]; count: number }>;
}

export async function runBacktest(body: {
  address: string;
  symbol?: string;
  timeframe?: string;
  startingBalance?: number;
}): Promise<BacktestItem> {
  const res = await apiFetch(`${API_BASE_URL}/backtests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<BacktestItem>;
}

export async function fetchSignalResults(opts?: { refresh?: boolean }) {
  const qs = opts?.refresh ? '?refresh=1' : '';
  const res = await apiFetch(`${API_BASE_URL}/signals/results${qs}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Signal results failed (${res.status}): ${body.slice(0, 160)}`);
  }
  return res.json() as Promise<{
    items: Array<{
      id: string;
      address: string;
      symbol: string;
      name: string;
      generatedAt: string;
      safetyScore: number;
      buyScore: number;
      entry: number;
      stopLoss: number;
      tp1Price: number;
      tp2Price: number;
      result: 'SUCCESS' | 'FAIL' | 'OPEN';
      outcome: {
        tp1Hit: boolean;
        tp2Hit: boolean;
        slHit: boolean;
        mfePct: number;
        maePct: number;
        firstExit: string;
      } | null;
      error?: string;
    }>;
    count: number;
    success: number;
    fail: number;
    open: number;
    successRatePct: number | null;
    note: string;
  }>;
}

export async function trackSignalOutcome(address: string) {
  const res = await apiFetch(`${API_BASE_URL}/signal-outcomes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    signalType: string;
    outcome: {
      tp1Hit: boolean;
      tp2Hit: boolean;
      slHit: boolean;
      mfePct: number;
      maePct: number;
      firstExit: string;
    };
  }>;
}

export type AppSettings = {
  tradingMode: string;
  beginnerMode: boolean;
  notifyBuySetups: boolean;
  notifyFxSetups: boolean;
  notifyPaperExits: boolean;
  notifyRealTrades: boolean;
  telegramEnabled: boolean;
  whatsappEnabled: boolean;
  emailEnabled: boolean;
  axiomRequiredForAutoTrading: boolean;
  killSwitch: boolean;
  emergencyStop: boolean;
  autoTradingEnabled: boolean;
  walletPublicKey: string | null;
  trackedWallets?: Array<{ address: string; label: string }>;
  maxSlippageBps: number;
  realTradingBroadcast: boolean;
  disclaimer: string;
};

export type RiskSettings = {
  safetyMin: number;
  signalMin: number;
  minLiquidityUsd: number;
  riskPerTradePct: number;
  tp1Pct: number;
  tp2Pct: number;
  tp1SellPct: number;
  tp2SellPct: number;
  remainingPct: number;
  minRiskReward: number;
  paperBalance: number;
  realAccountBalanceUsd: number;
};

export async function fetchSettings(): Promise<AppSettings> {
  const res = await apiFetch(`${API_BASE_URL}/settings`);
  if (!res.ok) throw new Error(`Settings failed (${res.status})`);
  return res.json() as Promise<AppSettings>;
}

export async function updateSettings(patch: Partial<AppSettings>) {
  const res = await apiFetch(`${API_BASE_URL}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<AppSettings>;
}

export async function fetchRiskSettings(): Promise<RiskSettings> {
  const res = await apiFetch(`${API_BASE_URL}/risk`);
  if (!res.ok) throw new Error(`Risk failed (${res.status})`);
  return res.json() as Promise<RiskSettings>;
}

export async function updateRiskSettings(patch: Partial<RiskSettings>) {
  const res = await apiFetch(`${API_BASE_URL}/risk`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<RiskSettings>;
}

export async function resetSettings() {
  const res = await apiFetch(`${API_BASE_URL}/settings/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type SmartWalletItem = {
  address: string;
  label: string;
  origin: 'VERIFIED' | 'USER';
};

export async function fetchSmartWallets(): Promise<{
  verified: SmartWalletItem[];
  user: SmartWalletItem[];
  all: SmartWalletItem[];
}> {
  const res = await apiFetch(`${API_BASE_URL}/settings/smart-wallets`);
  if (!res.ok) throw new Error(`Smart wallets failed (${res.status})`);
  return res.json();
}

export async function addSmartWallet(address: string, label?: string) {
  const res = await apiFetch(`${API_BASE_URL}/settings/smart-wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, label }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    settings: AppSettings;
    wallets: { verified: SmartWalletItem[]; user: SmartWalletItem[]; all: SmartWalletItem[] };
  }>;
}

export async function removeSmartWallet(address: string) {
  const res = await apiFetch(
    `${API_BASE_URL}/settings/smart-wallets/${encodeURIComponent(address)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type DiscoveredWalletRow = {
  address: string;
  label: string;
  smartScore: number;
  tier: 'A' | 'B' | 'C' | 'D';
  status: string;
  winRate: number;
  roi: number;
  averageHoldMin: number;
  earlyEntryScore: number;
  totalTrades: number;
  profitableCalls: number;
  realizedPnl: number;
  lastActive: string | null;
  confidenceScore: number;
  excluded: boolean;
  excludeReasons: string[];
  windows: { last24h: number; last7d: number; last30d: number; allTime: number };
};

export type SmartMoneyStatus = {
  lastCycle: string | null;
  lastError: string | null;
  wallets: number;
  tierA: number;
  tierB: number;
  trades: number;
  tracked: number;
  provider: string;
};

export async function fetchDiscoveredWallets(sort = 'smartScore'): Promise<{
  items: DiscoveredWalletRow[];
  count: number;
  status: SmartMoneyStatus;
}> {
  const res = await apiFetch(
    `${API_BASE_URL}/smart-money/wallets?sort=${encodeURIComponent(sort)}`,
  );
  if (!res.ok) throw new Error(`Smart-money wallets failed (${res.status})`);
  return res.json();
}

export async function fetchDiscoveredWallet(address: string) {
  const res = await apiFetch(
    `${API_BASE_URL}/smart-money/wallets/${encodeURIComponent(address)}`,
  );
  if (!res.ok) throw new Error(`Wallet ${address} failed (${res.status})`);
  return res.json() as Promise<{
    wallet: DiscoveredWalletRow | undefined;
    trades: Array<{
      token: string;
      type: string;
      usdValue: number;
      timestamp: number;
      txHash: string;
    }>;
    backtest: {
      avgGainAfterEntry: number;
      failRate: number;
      likelyLuck: boolean;
      consistent: boolean;
    } | null;
  }>;
}

export async function fetchSmartMoneySignals(limit = 20) {
  const res = await apiFetch(`${API_BASE_URL}/smart-money/signals?limit=${limit}`);
  if (!res.ok) throw new Error(`Smart-money signals failed (${res.status})`);
  return res.json() as Promise<{
    items: Array<{
      token: string;
      symbol: string;
      overallScore: number;
      smartMoneyScore: number;
      numberOfSmartWallets: number;
      tierAWallets: number;
      tierBWallets: number;
      signal: string;
      reason: string;
      timestamp: string;
    }>;
    count: number;
  }>;
}

export async function fetchNotifications(limit = 20) {
  const res = await apiFetch(`${API_BASE_URL}/notifications?limit=${limit}`);
  if (!res.ok) throw new Error(`Notifications failed (${res.status})`);
  return res.json() as Promise<{
    items: Array<{ id: string; title: string; body: string; sentAt: string; delivered?: boolean; channel?: string }>;
    count: number;
    telegramConfigured: boolean;
  }>;
}

export async function fetchNotificationStatus() {
  const res = await apiFetch(`${API_BASE_URL}/notifications/status`);
  if (!res.ok) throw new Error(`Notification status failed (${res.status})`);
  return res.json() as Promise<{
    telegramConfigured: boolean;
    telegramEnabled: boolean;
    telegram: { status: string; message?: string; botUsername?: string };
    whatsappConfigured?: boolean;
    whatsappEnabled?: boolean;
    whatsapp?: { status: string; message?: string; provider?: string };
    emailConfigured?: boolean;
    emailEnabled?: boolean;
    email?: { status: string; message?: string; from?: string; to?: string };
    redis: { status: string; message?: string };
    queueName: string;
    recentCount: number;
  }>;
}

export async function sendTestNotification() {
  const res = await apiFetch(`${API_BASE_URL}/notifications/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type TradeProposal = {
  id: string;
  status: string;
  symbol: string;
  tokenAddress: string;
  entryPrice: number;
  stopLoss: number;
  tp1Price: number;
  tp2Price: number;
  positionSizeUsd: number;
  riskReward: number;
  safetyScore: number;
  signalScore: number;
  jupiterQuoteOk: boolean;
  dataConflict: boolean;
  preTrade: { allowed: boolean; failed: string[] };
  unsignedSwapTx: string | null;
  txSignature: string | null;
  beginner: { decision: string; whatYouMustDo: string };
  disclaimer: string;
};

export async function fetchTradeProposals() {
  const res = await apiFetch(`${API_BASE_URL}/trades/proposals`);
  if (!res.ok) throw new Error(`Proposals failed (${res.status})`);
  return res.json() as Promise<{ items: TradeProposal[]; count: number }>;
}

export async function proposeTrade(address: string, sizeUsd?: number) {
  const res = await apiFetch(`${API_BASE_URL}/trades/propose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, sizeUsd }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<TradeProposal>;
}

export async function approveTrade(id: string) {
  const res = await apiFetch(`${API_BASE_URL}/trades/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmRealMoney: true }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<TradeProposal>;
}

export async function rejectTrade(id: string) {
  const res = await apiFetch(`${API_BASE_URL}/trades/${id}/reject`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<TradeProposal>;
}

export async function prepareTrade(id: string) {
  const res = await apiFetch(`${API_BASE_URL}/trades/${id}/prepare`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<TradeProposal>;
}

export async function setKillSwitch(on: boolean) {
  const res = await apiFetch(`${API_BASE_URL}/trading/kill-switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function activateEmergencyStop() {
  const res = await apiFetch(`${API_BASE_URL}/auto-trading/emergency-stop`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function enableAutoTrading() {
  const res = await apiFetch(`${API_BASE_URL}/auto-trading/enable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmRealMoney: true,
      acknowledgeWarning: true,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function disableAutoTrading() {
  const res = await apiFetch(`${API_BASE_URL}/auto-trading/disable`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function runAutoCycle(limit = 3) {
  const res = await apiFetch(`${API_BASE_URL}/auto-trading/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    gate: { ok: boolean; reason: string };
    scanned: number;
    buySignals: number;
    queued: TradeProposal[];
    blocked: Array<{ address: string; symbol?: string; reason: string }>;
    note: string;
    executionMode: string;
  }>;
}

export async function fetchTokenDetail(address: string) {
  const res = await apiFetch(`${API_BASE_URL}/tokens/${address}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<ScannerToken & { safety?: TokenSafety; pairs?: unknown[] }>;
}

export type TokenOhlcvCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type TokenOhlcvResponse = {
  address: string;
  timeframe: string;
  poolAddress: string;
  candles: TokenOhlcvCandle[];
  count: number;
};

export async function fetchTokenOhlcv(
  address: string,
  opts?: { timeframe?: string; limit?: number; pairAddress?: string | null },
): Promise<TokenOhlcvResponse> {
  const sp = new URLSearchParams();
  if (opts?.timeframe) sp.set('tf', opts.timeframe);
  if (opts?.limit) sp.set('limit', String(opts.limit));
  if (opts?.pairAddress) sp.set('pair', opts.pairAddress);
  const qs = sp.toString();
  const res = await apiFetch(
    `${API_BASE_URL}/tokens/${encodeURIComponent(address)}/ohlcv${qs ? `?${qs}` : ''}`,
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body.slice(0, 160) || `OHLCV failed (${res.status})`);
  }
  return res.json() as Promise<TokenOhlcvResponse>;
}

export async function fetchTokenSignal(address: string) {
  const res = await apiFetch(`${API_BASE_URL}/signals/token/${address}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<SignalItem>;
}

export type WatchlistItem = {
  address: string;
  symbol: string;
  name: string;
  imageUrl?: string | null;
  notes: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  priceChange24h: number | null;
  addedAt: string;
};

export async function fetchWatchlist() {
  const res = await apiFetch(`${API_BASE_URL}/watchlist`);
  if (!res.ok) throw new Error(`Watchlist failed (${res.status})`);
  return res.json() as Promise<{ items: WatchlistItem[]; count: number }>;
}

export async function addToWatchlist(address: string, notes?: string) {
  const res = await apiFetch(`${API_BASE_URL}/watchlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, notes }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<WatchlistItem>;
}

export async function removeFromWatchlist(address: string) {
  const res = await apiFetch(`${API_BASE_URL}/watchlist/${encodeURIComponent(address)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function watchlistExists(address: string) {
  const res = await apiFetch(
    `${API_BASE_URL}/watchlist/${encodeURIComponent(address)}/exists`,
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ address: string; watched: boolean }>;
}

export async function openPaperFromSignal(address: string) {
  const res = await apiFetch(`${API_BASE_URL}/paper-trades/from-signal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type BetBookmaker = 'bet9ja' | 'sportybet' | 'third';

export type BetFixture = {
  id: string;
  league: string;
  competition: string;
  kickoffUtc: string;
  venue?: string;
  status: string;
  home: { id: string; name: string; popular: boolean };
  away: { id: string; name: string; popular: boolean };
  popularMatch: boolean;
  live?: boolean;
  score?: { home: number | null; away: number | null };
  minute?: string;
  country?: string;
  countryFlag?: string;
  leagueHeading?: string;
};

export type BetMarketRow = {
  market: string;
  label: string;
  modelProbability: number;
  impliedProbability: number | null;
  edgePct: number | null;
  safetyScore: number;
  analysisScore?: number;
  confidence?: number;
  analysedOdds?: number | null;
  sampleDeliveryRate?: number | null;
  sampleSize?: number;
  historicalNote: string;
  category: string;
  riskLevel: string;
  reason: string;
  whyQualified?: string[];
  mainRisk?: string;
  sources?: string[];
  odds: {
    bestBook: BetBookmaker | null;
    bestOdds: number | null;
    books: Array<{
      bookmaker: BetBookmaker;
      label: string;
      decimalOdds: number | null;
      available: boolean;
      note?: string;
    }>;
  };
};

export type BetFixtureAnalysis = {
  fixture: BetFixture;
  popularity: { home: boolean; away: boolean; note: string };
  strength: { home: number; away: number; note: string };
  form: { home: string; away: string; last10Home?: string; last10Away?: string };
  teamStats?: {
    home: {
      name: string;
      last5: string;
      last10: string;
      played: number;
      wins: number;
      draws: number;
      losses: number;
      gf: number;
      ga: number;
      avgGf: number;
      avgGa: number;
      reliability: string;
      recent?: Array<{
        opponent: string;
        gf: number;
        ga: number;
        isHome: boolean;
        result: 'W' | 'D' | 'L';
        playedAt?: string;
      }>;
    };
    away: {
      name: string;
      last5: string;
      last10: string;
      played: number;
      wins: number;
      draws: number;
      losses: number;
      gf: number;
      ga: number;
      avgGf: number;
      avgGa: number;
      reliability: string;
      recent?: Array<{
        opponent: string;
        gf: number;
        ga: number;
        isHome: boolean;
        result: 'W' | 'D' | 'L';
        playedAt?: string;
      }>;
    };
  };
  homeAway: string;
  h2h: string;
  sources?: string[];
  noBet?: boolean;
  goals: { homeFor: number; homeAgainst: number; awayFor: number; awayAgainst: number };
  injuries: { home: string[]; away: string[]; note: string };
  lineup: {
    confirmed: boolean;
    homeXi: string[];
    awayXi: string[];
    missingHome: string[];
    missingAway: string[];
    rotationRisk: string;
    note: string;
  };
  matchImportance: string;
  halfGoalPick: { market: string; label: string; reason: string } | null;
  multiScore?: BetPackFields['multiScore'];
  markets: BetMarketRow[];
  recommended: BetMarketRow | null;
  avoidReasons: string[];
  disclaimer: string;
  ai?: {
    source: 'openai' | 'local';
    model: string;
    summary: string;
    homeRead: string;
    awayRead: string;
    lean: string;
    market: string;
    why: string[];
    risk: string;
    note: string;
  };
};

export type BetSlipSelection = {
  fixtureId: string;
  home: string;
  away: string;
  kickoffUtc: string;
  market: string;
  label: string;
  odds: number | null;
  bookmaker: BetBookmaker;
  safetyScore: number;
  riskLevel: string;
};

export async function fetchBetStatus() {
  const res = await apiFetch(`${API_BASE_URL}/bet-bot/status`);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{
    footballData: string;
    oddsApi: string;
    bookmakers: Array<{ id: string; label: string; oddsFeed: string }>;
    bookingCodes: string;
    ai?: string;
    disclaimer: string;
  }>;
}

export async function fetchBetFixtures(params?: {
  q?: string;
  league?: string;
  popular?: boolean;
  date?: string;
}) {
  const sp = new URLSearchParams();
  if (params?.q) sp.set('q', params.q);
  if (params?.league) sp.set('league', params.league);
  if (params?.popular === true) sp.set('popular', '1');
  else sp.set('popular', 'all');
  if (params?.date) sp.set('date', params.date);
  const qs = sp.toString();
  const res = await apiFetch(`${API_BASE_URL}/bet-bot/fixtures${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{
    source: string;
    count: number;
    items: BetFixture[];
    warning?: string;
    note?: string;
    disclaimer: string;
  }>;
}

export async function fetchBetLiveFixtures(params?: {
  q?: string;
  league?: string;
  popular?: boolean;
}) {
  const sp = new URLSearchParams();
  if (params?.q) sp.set('q', params.q);
  if (params?.league) sp.set('league', params.league);
  if (params?.popular === true) sp.set('popular', '1');
  else sp.set('popular', 'all');
  const qs = sp.toString();
  const res = await apiFetch(`${API_BASE_URL}/bet-bot/fixtures/live${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{
    source: string;
    liveCount: number;
    live: BetFixture[];
    upcoming: BetFixture[];
    note?: string;
    disclaimer: string;
  }>;
}

export async function fetchBetFixture(id: string) {
  const res = await apiFetch(`${API_BASE_URL}/bet-bot/fixtures/${encodeURIComponent(id)}`);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<BetFixtureAnalysis>;
}

export type BetBookmakerSlip = {
  id: BetBookmaker;
  label: string;
  site: string | null;
  how: string;
  bookingCode: null;
  copyText: string;
  avgSafety: number;
  avgDelivery: number;
};

export type BetPackFields = {
  home?: string;
  away?: string;
  country?: string;
  countryFlag?: string;
  leagueHeading?: string;
  last5Home?: string;
  last5Away?: string;
  scoresHome?: string;
  scoresAway?: string;
  aiSummary?: string;
  multiScore?: {
    side: 'HOME' | 'AWAY';
    label: string;
    scores: Array<{ line: string; home: number; away: number; probability: number }>;
    combinedProbability: number;
    analysedOdds: number | null;
    reason: string;
  };
};

export type BetBookingLeg = BetMarketRow &
  BetPackFields & {
    fixtureId: string;
    home: string;
    away: string;
    match: string;
    kickoffUtc: string;
    league: string;
    deliveryRate: number;
    popularMatch?: boolean;
  };

export type BetPickRow = BetMarketRow &
  BetPackFields & {
    fixtureId: string;
    match: string;
    kickoffUtc: string;
    league: string;
    deliveryRate?: number;
    popularMatch?: boolean;
  };

export type BetAccumulator = {
  minScore: number;
  legs: BetBookingLeg[];
  note: string;
};

export async function fetchBetPicks() {
  const res = await apiFetch(`${API_BASE_URL}/bet-bot/picks`);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{
    safest: BetPickRow[];
    popularPicks?: BetPickRow[];
    otherPicks?: BetPickRow[];
    bestValue: BetPickRow[];
    highOdds: BetPickRow[];
    multiScore?: BetPickRow[];
    elite?: BetPickRow[];
    avoid: Array<{ fixtureId: string; match: string; reasons: string[] }>;
    booking: { legs: BetBookingLeg[]; note: string; bookSlips: BetBookmakerSlip[]; accumulators?: {
      safe: BetAccumulator;
      balanced: BetAccumulator;
      highOdds: BetAccumulator;
    }; daily100?: {
      target: number;
      legs: BetBookingLeg[];
      combinedAnalysedOdds: number | null;
      note: string;
      bookSlips?: BetBookmakerSlip[];
    } };
    accumulators?: {
      safe: BetAccumulator;
      balanced: BetAccumulator;
      highOdds: BetAccumulator;
    };
    daily100?: {
      target: number;
      legs: BetBookingLeg[];
      combinedAnalysedOdds: number | null;
      note: string;
      bookSlips?: BetBookmakerSlip[];
    };
    noBet?: boolean;
    note?: string;
    disclaimer: string;
  }>;
}

export async function fetchBetBooking() {
  const res = await apiFetch(`${API_BASE_URL}/bet-bot/picks/booking`);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{
    legs: BetBookingLeg[];
    note: string;
    bookSlips: BetBookmakerSlip[];
    disclaimer: string;
  }>;
}

export async function quoteBetSlip(bookmaker: BetBookmaker, selections: BetSlipSelection[]) {
  const res = await apiFetch(`${API_BASE_URL}/bet-bot/slip`, {
    method: 'POST',
    body: JSON.stringify({ bookmaker, selections }),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{
    id: string;
    bookmaker: BetBookmaker;
    selections: BetSlipSelection[];
    combinedOdds: number | null;
    avgSafety: number;
    bookingCode: null;
    bookingStatus: string;
    message: string;
    disclaimer: string;
  }>;
}

export async function verifyBetTicket(body: {
  bookmaker: BetBookmaker;
  bookingCode?: string;
  pastedSelections?: Array<{ match?: string; market?: string; odds?: number }>;
  botSelections: BetSlipSelection[];
}) {
  const res = await apiFetch(`${API_BASE_URL}/bet-bot/ticket/verify`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{
    supported: boolean;
    message?: string;
    matching: string[];
    missing: string[];
    changed: string[];
    oddsChanges: string[];
    totalOddsBot: number | null;
    totalOddsTicket: number | null;
    disclaimer: string;
  }>;
}

export type FxSide = 'BUY' | 'SELL';

export type FxQuote = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spreadPips: number;
  timestamp: string;
  ageMs: number;
  stale: boolean;
  source: string;
  dataQuality: 'LIVE' | 'DEGRADED' | 'SYNTHETIC';
};

export type FxPipelineStep = { stage: string; ok: boolean; at: string; note: string };

export type FxSignal = {
  id: string;
  symbol: string;
  side: FxSide;
  quote: FxQuote;
  zone: { low: number; high: number; mid: number; widthPips: number };
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  stopPips: number;
  suggestedLots: number;
  riskUsd: number;
  setupQuality: number;
  confidence: {
    setupQuality: number;
    estimatedHitRateLowPct: number | null;
    estimatedHitRateHighPct: number | null;
    sampleNote: string;
    warning: string;
  };
  reasons: string[];
  expiresAt: string;
  createdAt: string;
  pipeline: { stage: string; steps: FxPipelineStep[] };
};

export type FxPosition = {
  id: string;
  signalId: string;
  symbol: string;
  side: FxSide;
  entry: number;
  lotsOpen: number;
  lotsOriginal: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp1Filled: boolean;
  tp2Filled: boolean;
  breakevenOn: boolean;
  trailingOn: boolean;
  realizedUsd: number;
  unrealizedUsd: number;
  events: string[];
  pipeline: { stage: string };
};

export type FxJournalEntry = {
  id: string;
  symbol: string;
  side: FxSide;
  entry: number;
  exit: number;
  pnlUsd: number;
  rMultiple: number;
  setupQuality: number;
  exitReason: string;
  closedAt: string;
};

export type FxRisk = {
  balance: number;
  equity: number;
  dailyPnlUsd: number;
  weeklyPnlUsd: number;
  dailyDrawdownPct: number;
  weeklyDrawdownPct: number;
  dailyHalt: boolean;
  weeklyHalt: boolean;
  openPositions: number;
  maxOpen: number;
  usdExposureLots: number;
  correlationBlocks: string[];
  killSwitch: boolean;
  mode: 'PAPER' | 'LIVE';
  liveBlockedReason: string | null;
};

export type FxBoardRow = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spreadPips: number;
  changePct: number;
  changePips: number;
  bias: 'BUY' | 'SELL' | 'WAIT';
  setupQuality: number;
  buyPct: number;
  sellPct: number;
  rsi: number | null;
  atrPips: number | null;
  tradeable: boolean;
  signalId: string | null;
  reasons: string[];
  blockers: string[];
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  zone: { low: number; high: number; mid: number; widthPips: number } | null;
  stale: boolean;
  dataQuality: 'LIVE' | 'DEGRADED' | 'SYNTHETIC';
};

export async function fetchForexStatus() {
  const res = await apiFetch(`${API_BASE_URL}/forex-bot/status`);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{
    pipeline: string[];
    mode: 'PAPER' | 'LIVE';
    killSwitch: boolean;
    session: { name: string; forexOpen: boolean; rollover: boolean; note: string };
    scoringNote: string;
    disclaimer: string;
    liveBlockedReason: string | null;
  }>;
}

export async function fetchForexScan() {
  const res = await apiFetch(`${API_BASE_URL}/forex-bot/scan`, undefined, 45000);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{
    pipeline: FxPipelineStep[];
    signals: FxSignal[];
    rejected: Array<{ symbol: string; stage: string; reasons: string[] }>;
    duplicateSuppressed: number;
    source: string;
    session: { name: string; forexOpen: boolean; note: string };
    quotes: FxQuote[];
    board: FxBoardRow[];
    risk: FxRisk;
    halt: string | null;
    disclaimer: string;
  }>;
}

export async function fetchForexSignal(id: string) {
  const res = await apiFetch(`${API_BASE_URL}/forex-bot/signals/${encodeURIComponent(id)}`);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{ signal: FxSignal; disclaimer: string }>;
}

export async function recheckForexSignal(id: string, side: FxSide) {
  const res = await apiFetch(`${API_BASE_URL}/forex-bot/signals/${encodeURIComponent(id)}/recheck`, {
    method: 'POST',
    body: JSON.stringify({ side }),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{
    ok: boolean;
    blockers: string[];
    stillInZone: boolean;
    spreadPips: number | null;
    slippagePips: number | null;
    signal: FxSignal;
    disclaimer: string;
  }>;
}

export async function executeForexSignal(id: string, side: FxSide) {
  const res = await apiFetch(`${API_BASE_URL}/forex-bot/signals/${encodeURIComponent(id)}/execute`, {
    method: 'POST',
    body: JSON.stringify({ side }),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{ position: FxPosition; fill: number; disclaimer: string }>;
}

export async function fetchForexPositions() {
  const res = await apiFetch(`${API_BASE_URL}/forex-bot/positions`);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{ items: FxPosition[]; count: number }>;
}

export async function tickForexPositions() {
  const res = await apiFetch(`${API_BASE_URL}/forex-bot/positions/tick`, { method: 'POST' });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{ events: string[]; positions: FxPosition[] }>;
}

export async function closeForexPosition(id: string) {
  const res = await apiFetch(`${API_BASE_URL}/forex-bot/positions/${encodeURIComponent(id)}/close`, {
    method: 'POST',
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json();
}

export async function fetchForexJournal() {
  const res = await apiFetch(`${API_BASE_URL}/forex-bot/journal`);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{
    items: FxJournalEntry[];
    analytics: {
      trades: number;
      wins: number;
      losses: number;
      winRatePct: number | null;
      expectancyUsd: number | null;
      profitFactor: number | null;
      avgR: number | null;
      note: string;
    };
    disclaimer: string;
  }>;
}

export async function fetchForexRisk() {
  const res = await apiFetch(`${API_BASE_URL}/forex-bot/risk`);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<FxRisk>;
}

export async function fetchForexCalendar() {
  const res = await apiFetch(`${API_BASE_URL}/forex-bot/calendar`);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{
    session: { name: string; note: string; forexOpen: boolean };
    upcoming: Array<{ id: string; name: string; currency: string; startsAt: string; endsAt: string }>;
    active: Array<{ id: string; name: string; currency: string }>;
  }>;
}

export async function fetchForexBacktest() {
  const res = await apiFetch(`${API_BASE_URL}/forex-bot/backtest`);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{
    report: { passed: boolean; reasons: string[]; note: string };
    requirement: string;
  }>;
}

export async function setForexKillSwitch(on: boolean) {
  const res = await apiFetch(`${API_BASE_URL}/forex-bot/kill-switch`, {
    method: 'POST',
    body: JSON.stringify({ on }),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<{ killSwitch: boolean }>;
}

export async function emergencyForexStop() {
  const res = await apiFetch(`${API_BASE_URL}/forex-bot/emergency-stop`, { method: 'POST' });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json();
}

