import { DEFAULT_RISK } from '@memecoinbot/shared';
import {
  dollarRisk,
  evaluateRiskLimits,
  positionSizeUsd,
  updateTrailingStop,
  type TrailingMethod,
} from '@memecoinbot/risk';

export type PaperExitReason =
  | 'TP1'
  | 'TP2'
  | 'TRAILING_STOP'
  | 'STOP_LOSS'
  | 'MANUAL'
  | 'INVALIDATED'
  | 'EMERGENCY';

export type PaperFill = {
  at: string;
  price: number;
  sizeUsd: number;
  qtyPct: number;
  feeUsd: number;
  slippageUsd: number;
  reason: PaperExitReason | 'ENTRY';
  realizedPnlUsd: number;
};

export type PaperPosition = {
  id: string;
  tokenAddress: string;
  symbol: string;
  strategy?: string;
  status: 'OPEN' | 'PARTIAL' | 'CLOSED';
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  initialStopLoss: number;
  tp1Price: number;
  tp2Price: number;
  trailingStop: number | null;
  trailingEnabled: boolean;
  trailingMethod: TrailingMethod;
  sizeUsd: number;
  remainingPct: number;
  realizedPnlUsd: number;
  feesUsd: number;
  slippageUsd: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  safetyScore?: number;
  signalScore?: number;
  entryReason?: string;
  exitReason?: PaperExitReason;
  openedAt: string;
  closedAt?: string;
  fills: PaperFill[];
  atr?: number | null;
};

export type PaperAccountState = {
  startingBalance: number;
  balance: number;
  equity: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  dailyRealizedPnl: number;
  dailyTrades: number;
  consecutiveLosses: number;
  dayKey: string;
  positions: PaperPosition[];
  closedTrades: PaperPosition[];
};

export type PaperConfig = {
  feeBps: number;
  slippageBps: number;
  riskPct: number;
  maxOpenPositions: number;
  maxDailyTrades: number;
  maxDailyLossPct: number;
  maxExposurePct: number;
  maxConsecutiveLosses: number;
  tp1SellPct: number;
  tp2SellPct: number;
  remainingPct: number;
  trailingMethod: TrailingMethod;
  trailingAtrMult: number;
  trailingPct: number;
};

export const DEFAULT_PAPER_CONFIG: PaperConfig = {
  feeBps: 30,
  slippageBps: 50,
  riskPct: DEFAULT_RISK.riskPerTradePct,
  maxOpenPositions: DEFAULT_RISK.maxOpenPositions,
  maxDailyTrades: DEFAULT_RISK.maxDailyTrades,
  maxDailyLossPct: DEFAULT_RISK.maxDailyLossPct,
  maxExposurePct: DEFAULT_RISK.maxExposurePct,
  maxConsecutiveLosses: DEFAULT_RISK.maxConsecutiveLosses,
  tp1SellPct: DEFAULT_RISK.tp1SellPct,
  tp2SellPct: DEFAULT_RISK.tp2SellPct,
  remainingPct: DEFAULT_RISK.remainingPct,
  trailingMethod: 'ATR',
  trailingAtrMult: 2,
  trailingPct: 8,
};

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function applyCost(notional: number, bps: number): number {
  return (notional * bps) / 10_000;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
}

export function createPaperAccount(
  startingBalance: number = DEFAULT_RISK.paperBalance,
): PaperAccountState {
  return {
    startingBalance,
    balance: startingBalance,
    equity: startingBalance,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    dailyRealizedPnl: 0,
    dailyTrades: 0,
    consecutiveLosses: 0,
    dayKey: dayKey(),
    positions: [],
    closedTrades: [],
  };
}

function refreshDay(account: PaperAccountState): void {
  const today = dayKey();
  if (account.dayKey !== today) {
    account.dayKey = today;
    account.dailyRealizedPnl = 0;
    account.dailyTrades = 0;
  }
}

export function markToMarket(
  account: PaperAccountState,
  prices: Record<string, number>,
): PaperAccountState {
  let unrealized = 0;
  for (const pos of account.positions) {
    const px = prices[pos.tokenAddress] ?? pos.currentPrice;
    pos.currentPrice = px;
    const remainingNotional = pos.sizeUsd * (pos.remainingPct / 100);
    const pnl =
      remainingNotional * ((px - pos.entryPrice) / pos.entryPrice);
    unrealized += pnl;
  }
  account.unrealizedPnlUsd = unrealized;
  account.equity = account.balance + unrealized;
  return account;
}

export function openPaperPosition(
  account: PaperAccountState,
  params: {
    tokenAddress: string;
    symbol: string;
    entryPrice: number;
    stopLoss: number;
    tp1Price: number;
    tp2Price: number;
    strategy?: string;
    safetyScore?: number;
    signalScore?: number;
    entryReason?: string;
    atr?: number | null;
    trailingEnabled?: boolean;
    config?: Partial<PaperConfig>;
  },
): { account: PaperAccountState; position?: PaperPosition; error?: string } {
  refreshDay(account);
  const config = { ...DEFAULT_PAPER_CONFIG, ...params.config };
  const entrySlip = applyCost(params.entryPrice, config.slippageBps);
  const fillPrice = params.entryPrice + entrySlip;

  const sizeUsd = positionSizeUsd({
    accountBalance: account.balance,
    riskPct: config.riskPct,
    entry: fillPrice,
    stopLoss: params.stopLoss,
  });

  const openCount = account.positions.filter((p) => p.status !== 'CLOSED').length;
  const exposure = account.positions.reduce(
    (sum, p) => sum + p.sizeUsd * (p.remainingPct / 100),
    0,
  );

  const limits = evaluateRiskLimits({
    accountBalance: account.balance,
    startingBalance: account.startingBalance,
    openPositions: openCount,
    dailyTrades: account.dailyTrades,
    dailyRealizedPnl: account.dailyRealizedPnl,
    consecutiveLosses: account.consecutiveLosses,
    currentExposureUsd: exposure,
    proposedSizeUsd: sizeUsd,
    maxDailyLossPct: config.maxDailyLossPct,
    maxOpenPositions: config.maxOpenPositions,
    maxDailyTrades: config.maxDailyTrades,
    maxExposurePct: config.maxExposurePct,
    maxConsecutiveLosses: config.maxConsecutiveLosses,
  });

  if (!limits.allowed) {
    return { account, error: limits.reasons[0] ?? 'NO NEW TRADES' };
  }

  const feeUsd = applyCost(sizeUsd, config.feeBps);
  const slippageUsd = applyCost(sizeUsd, config.slippageBps);
  if (sizeUsd + feeUsd > account.balance) {
    return { account, error: 'Insufficient paper balance' };
  }

  const position: PaperPosition = {
    id: nextId('pp'),
    tokenAddress: params.tokenAddress,
    symbol: params.symbol,
    strategy: params.strategy,
    status: 'OPEN',
    entryPrice: fillPrice,
    currentPrice: fillPrice,
    stopLoss: params.stopLoss,
    initialStopLoss: params.stopLoss,
    tp1Price: params.tp1Price,
    tp2Price: params.tp2Price,
    trailingStop: null,
    trailingEnabled: params.trailingEnabled ?? true,
    trailingMethod: config.trailingMethod,
    sizeUsd,
    remainingPct: 100,
    realizedPnlUsd: 0,
    feesUsd: feeUsd,
    slippageUsd,
    tp1Hit: false,
    tp2Hit: false,
    safetyScore: params.safetyScore,
    signalScore: params.signalScore,
    entryReason: params.entryReason,
    openedAt: new Date().toISOString(),
    fills: [
      {
        at: new Date().toISOString(),
        price: fillPrice,
        sizeUsd,
        qtyPct: 100,
        feeUsd,
        slippageUsd,
        reason: 'ENTRY',
        realizedPnlUsd: 0,
      },
    ],
    atr: params.atr,
  };

  account.balance -= sizeUsd + feeUsd;
  account.dailyTrades += 1;
  account.positions.push(position);
  markToMarket(account, { [params.tokenAddress]: fillPrice });
  return { account, position };
}

function closePortion(
  account: PaperAccountState,
  position: PaperPosition,
  qtyPctOfOriginal: number,
  price: number,
  reason: PaperExitReason,
  config: PaperConfig,
): void {
  if (qtyPctOfOriginal <= 0 || position.remainingPct <= 0) return;

  const sellPct = Math.min(qtyPctOfOriginal, position.remainingPct);
  const notional = position.sizeUsd * (sellPct / 100);
  const slip = applyCost(price, config.slippageBps);
  const fillPrice = Math.max(0, price - slip);
  const feeUsd = applyCost(notional, config.feeBps);
  const proceeds = notional * (fillPrice / position.entryPrice);
  const pnl =
    notional * ((fillPrice - position.entryPrice) / position.entryPrice) - feeUsd;

  position.remainingPct = Math.max(0, position.remainingPct - sellPct);
  position.realizedPnlUsd += pnl;
  position.feesUsd += feeUsd;
  position.slippageUsd += applyCost(notional, config.slippageBps);
  position.exitReason = reason;
  position.fills.push({
    at: new Date().toISOString(),
    price: fillPrice,
    sizeUsd: notional,
    qtyPct: sellPct,
    feeUsd,
    slippageUsd: applyCost(notional, config.slippageBps),
    reason,
    realizedPnlUsd: pnl,
  });

  account.balance += proceeds - feeUsd;
  account.realizedPnlUsd += pnl;
  account.dailyRealizedPnl += pnl;

  if (position.remainingPct <= 0.0001) {
    position.remainingPct = 0;
    position.status = 'CLOSED';
    position.closedAt = new Date().toISOString();
    if (position.realizedPnlUsd < 0) account.consecutiveLosses += 1;
    else account.consecutiveLosses = 0;
    account.positions = account.positions.filter((p) => p.id !== position.id);
    account.closedTrades.unshift(position);
  } else {
    position.status = 'PARTIAL';
  }
}

export function processPriceUpdate(
  account: PaperAccountState,
  tokenAddress: string,
  price: number,
  configPartial?: Partial<PaperConfig>,
): { account: PaperAccountState; events: string[] } {
  refreshDay(account);
  const config = { ...DEFAULT_PAPER_CONFIG, ...configPartial };
  const events: string[] = [];
  const open = account.positions.filter((p) => p.tokenAddress === tokenAddress);

  for (const position of open) {
    position.currentPrice = price;

    // Stop loss (initial or trailing)
    const activeStop =
      position.trailingStop != null
        ? Math.max(position.stopLoss, position.trailingStop)
        : position.stopLoss;

    if (price <= activeStop) {
      const reason: PaperExitReason =
        position.trailingStop != null && price <= (position.trailingStop ?? 0)
          ? 'TRAILING_STOP'
          : 'STOP_LOSS';
      closePortion(account, position, position.remainingPct, price, reason, config);
      events.push(`${reason} ${position.symbol}`);
      continue;
    }

    // TP1
    if (!position.tp1Hit && price >= position.tp1Price) {
      position.tp1Hit = true;
      closePortion(account, position, config.tp1SellPct, price, 'TP1', config);
      events.push(`TP1 HIT ${position.symbol}`);
    }

    // TP2 (only if still open)
    if (
      position.remainingPct > 0 &&
      !position.tp2Hit &&
      price >= position.tp2Price
    ) {
      position.tp2Hit = true;
      closePortion(account, position, config.tp2SellPct, price, 'TP2', config);
      events.push(`TP2 HIT ${position.symbol}`);
      if (position.remainingPct > 0 && position.trailingEnabled) {
        position.trailingStop = updateTrailingStop({
          method: position.trailingMethod,
          side: 'long',
          currentStop: activeStop,
          price,
          atr: position.atr,
          atrMult: config.trailingAtrMult,
          trailPct: config.trailingPct,
        });
        events.push(`TRAILING STOP ACTIVE ${position.symbol}`);
      }
    }

    // Trail remaining after TP2
    if (
      position.remainingPct > 0 &&
      position.tp2Hit &&
      position.trailingEnabled
    ) {
      const prev = position.trailingStop ?? activeStop;
      position.trailingStop = updateTrailingStop({
        method: position.trailingMethod,
        side: 'long',
        currentStop: prev,
        price,
        atr: position.atr,
        atrMult: config.trailingAtrMult,
        trailPct: config.trailingPct,
      });
    }
  }

  markToMarket(account, { [tokenAddress]: price });
  return { account, events };
}

export function forceCloseRemaining(
  account: PaperAccountState,
  price: number,
  configPartial?: Partial<PaperConfig>,
): PaperAccountState {
  const config = { ...DEFAULT_PAPER_CONFIG, ...configPartial };
  for (const position of [...account.positions]) {
    closePortion(
      account,
      position,
      position.remainingPct,
      price,
      'MANUAL',
      config,
    );
  }
  markToMarket(account, {});
  return account;
}

/** Developer TEST MODE helpers — simulate market events without waiting */
export type PaperTestEvent =
  | 'PRICE_UP'
  | 'PRICE_DOWN'
  | 'TP1'
  | 'TP2'
  | 'SL'
  | 'TRAIL'
  | 'LIQUIDITY_COLLAPSE';

export function applyTestEvent(
  account: PaperAccountState,
  positionId: string,
  event: PaperTestEvent,
  configPartial?: Partial<PaperConfig>,
): { account: PaperAccountState; events: string[]; error?: string } {
  const position = account.positions.find((p) => p.id === positionId);
  if (!position) return { account, events: [], error: 'Position not found' };

  let price = position.currentPrice;
  switch (event) {
    case 'PRICE_UP':
      price = position.currentPrice * 1.1;
      break;
    case 'PRICE_DOWN':
      price = position.currentPrice * 0.95;
      break;
    case 'TP1':
      price = position.tp1Price * 1.001;
      break;
    case 'TP2':
      price = position.tp2Price * 1.001;
      break;
    case 'SL':
      price = position.stopLoss * 0.999;
      break;
    case 'TRAIL':
      if (!position.tp2Hit) {
        // force through TP1+TP2 first then trail hit
        let acc = account;
        ({ account: acc } = processPriceUpdate(
          acc,
          position.tokenAddress,
          position.tp1Price * 1.001,
          configPartial,
        ));
        ({ account: acc } = processPriceUpdate(
          acc,
          position.tokenAddress,
          position.tp2Price * 1.001,
          configPartial,
        ));
        const pos = acc.positions.find((p) => p.id === positionId);
        if (!pos) return { account: acc, events: ['TP1', 'TP2', 'FULLY CLOSED'] };
        price = (pos.trailingStop ?? pos.stopLoss) * 0.999;
        return processPriceUpdate(acc, pos.tokenAddress, price, configPartial);
      }
      price = (position.trailingStop ?? position.stopLoss) * 0.999;
      break;
    case 'LIQUIDITY_COLLAPSE':
      price = position.entryPrice * 0.5;
      break;
  }

  return processPriceUpdate(account, position.tokenAddress, price, configPartial);
}

export type PaperPerformance = {
  startingBalance: number;
  currentBalance: number;
  equity: number;
  totalPnl: number;
  totalPnlPct: number;
  winRate: number;
  lossRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  openPositions: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  currentLosingStreak: number;
  tp1HitRate: number;
  tp2HitRate: number;
  slRate: number;
};

export function computePaperPerformance(
  account: PaperAccountState,
): PaperPerformance {
  const closed = account.closedTrades;
  const wins = closed.filter((t) => t.realizedPnlUsd > 0);
  const losses = closed.filter((t) => t.realizedPnlUsd < 0);
  const grossWin = wins.reduce((s, t) => s + t.realizedPnlUsd, 0);
  const grossLossAbs = Math.abs(
    losses.reduce((s, t) => s + t.realizedPnlUsd, 0),
  );
  const totalPnl = account.equity - account.startingBalance;
  const totalPnlPct =
    account.startingBalance > 0
      ? (totalPnl / account.startingBalance) * 100
      : 0;

  // Approx max drawdown from closed trade equity path
  let peak = account.startingBalance;
  let equity = account.startingBalance;
  let maxDd = 0;
  for (const t of [...closed].reverse()) {
    equity += t.realizedPnlUsd;
    peak = Math.max(peak, equity);
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    maxDd = Math.max(maxDd, dd);
  }

  const tp1Hits = closed.filter((t) => t.tp1Hit).length;
  const tp2Hits = closed.filter((t) => t.tp2Hit).length;
  const slHits = closed.filter(
    (t) => t.exitReason === 'STOP_LOSS' || t.exitReason === 'TRAILING_STOP',
  ).length;

  return {
    startingBalance: account.startingBalance,
    currentBalance: account.balance,
    equity: account.equity,
    totalPnl,
    totalPnlPct,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    lossRate: closed.length ? (losses.length / closed.length) * 100 : 0,
    profitFactor: grossLossAbs > 0 ? grossWin / grossLossAbs : grossWin > 0 ? Infinity : 0,
    maxDrawdownPct: maxDd,
    averageWin: wins.length ? grossWin / wins.length : 0,
    averageLoss: losses.length ? -grossLossAbs / losses.length : 0,
    largestWin: wins.reduce((m, t) => Math.max(m, t.realizedPnlUsd), 0),
    largestLoss: losses.reduce((m, t) => Math.min(m, t.realizedPnlUsd), 0),
    openPositions: account.positions.length,
    totalTrades: closed.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    currentLosingStreak: account.consecutiveLosses,
    tp1HitRate: closed.length ? (tp1Hits / closed.length) * 100 : 0,
    tp2HitRate: closed.length ? (tp2Hits / closed.length) * 100 : 0,
    slRate: closed.length ? (slHits / closed.length) * 100 : 0,
  };
}

export { dollarRisk, positionSizeUsd };
