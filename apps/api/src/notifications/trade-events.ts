export type TradeEventKind =
  | 'BUY_CONFIRMED'
  | 'SELL_CONFIRMED'
  | 'TX_PENDING'
  | 'TX_CONFIRMED'
  | 'TX_FAILED'
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'SELL_SUBMITTED'
  | 'TRADE_SUCCEEDED'
  | 'TRADE_FAILED'
  | 'TRADE_PROFIT'
  | 'TRADE_LOSS';

export type TradeAssetClass = 'MEMECOIN' | 'FOREX';

export type TradeEventPayload = {
  kind: TradeEventKind;
  eventId: string;
  symbol: string;
  tokenAddress?: string;
  amountUsd?: number;
  tokenQuantity?: number;
  entryPrice?: number;
  exitPrice?: number;
  currentPrice?: number;
  receivedUsd?: number;
  pnlUsd?: number;
  roiPct?: number;
  reason?: string;
  takeProfitPct?: number;
  stopLossPct?: number;
  txSignature?: string | null;
  tradeId?: string;
  side?: 'BUY' | 'SELL';
  assetClass?: TradeAssetClass;
  executionMode?: 'LIVE' | 'PAPER' | 'DEMO';
};

function usd(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(3)}`;
}

function qty(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}

function signedUsd(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sign}${usd(Math.abs(n))}`;
}

function signedPct(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

export function formatTradeEvent(payload: TradeEventPayload): { title: string; body: string } {
  const token = `$${payload.symbol}`;
  const asset = payload.assetClass === 'FOREX' ? payload.symbol : token;
  const mode = payload.executionMode ? ` (${payload.executionMode.toLowerCase()})` : '';
  switch (payload.kind) {
    case 'TRADE_SUCCEEDED':
      return {
        title: `${payload.side ?? 'Trade'} successful — ${asset}`,
        body: [
          `${asset}${mode}`,
          '',
          `${payload.side ?? 'Trade'} completed successfully.`,
          payload.amountUsd != null ? `Amount: ${usd(payload.amountUsd)}` : null,
          payload.tokenQuantity != null ? `Quantity: ${qty(payload.tokenQuantity)}` : null,
          payload.entryPrice != null || payload.exitPrice != null
            ? `Fill Price: ${usd(payload.entryPrice ?? payload.exitPrice)}`
            : null,
          payload.receivedUsd != null ? `Received: ${usd(payload.receivedUsd)}` : null,
          payload.pnlUsd != null ? `PnL: ${signedUsd(payload.pnlUsd)}` : null,
          payload.roiPct != null ? `ROI: ${signedPct(payload.roiPct)}` : null,
          payload.tradeId ? `Trade ID: ${payload.tradeId}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    case 'TRADE_FAILED':
      return {
        title: `${payload.side ?? 'Trade'} failed — ${asset}`,
        body: [
          `${asset}${mode}`,
          '',
          `${payload.side ?? 'Trade'} was not completed.`,
          `Reason: ${payload.reason ?? 'The trade could not be completed.'}`,
          payload.tradeId ? `Trade ID: ${payload.tradeId}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    case 'TRADE_PROFIT':
      return {
        title: 'Success',
        body: [
          `${asset}${mode}`,
          '',
          'Trade finished with profit.',
          payload.side ? `Side: ${payload.side}` : null,
          payload.entryPrice != null ? `Entry: ${usd(payload.entryPrice)}` : null,
          payload.exitPrice != null ? `Exit: ${usd(payload.exitPrice)}` : null,
          payload.pnlUsd != null ? `Profit: ${signedUsd(payload.pnlUsd)}` : null,
          payload.roiPct != null ? `ROI: ${signedPct(payload.roiPct)}` : null,
          payload.reason ? `Reason: ${payload.reason}` : null,
          payload.tradeId ? `Trade ID: ${payload.tradeId}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    case 'TRADE_LOSS':
      return {
        title: 'Failure',
        body: [
          `${asset}${mode}`,
          '',
          'Trade finished with loss.',
          payload.side ? `Side: ${payload.side}` : null,
          payload.entryPrice != null ? `Entry: ${usd(payload.entryPrice)}` : null,
          payload.exitPrice != null ? `Exit: ${usd(payload.exitPrice)}` : null,
          payload.pnlUsd != null ? `Loss: ${signedUsd(payload.pnlUsd)}` : null,
          payload.roiPct != null ? `ROI: ${signedPct(payload.roiPct)}` : null,
          payload.reason ? `Reason: ${payload.reason}` : null,
          payload.tradeId ? `Trade ID: ${payload.tradeId}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    case 'BUY_CONFIRMED':
      return {
        title: 'Buy Confirmed',
        body: [
          token,
          '',
          `Amount: ${usd(payload.amountUsd)}`,
          `Tokens Received: ${qty(payload.tokenQuantity)}`,
          `Entry Price: ${usd(payload.entryPrice)}`,
          '',
          'Transaction: Confirmed',
        ].join('\n'),
      };
    case 'SELL_CONFIRMED':
      return {
        title: 'Sell Confirmed',
        body: [
          token,
          '',
          `Amount Sold: ${qty(payload.tokenQuantity)}`,
          `Received: ${usd(payload.receivedUsd ?? payload.amountUsd)}`,
          '',
          `PnL: ${signedUsd(payload.pnlUsd)}`,
          `ROI: ${signedPct(payload.roiPct)}`,
          '',
          'Transaction: Confirmed',
        ].join('\n'),
      };
    case 'TX_PENDING':
      return {
        title: 'Trade Pending',
        body: `Your ${token} transaction has been submitted and is waiting for confirmation.`,
      };
    case 'TX_CONFIRMED':
      return {
        title: 'Trade Confirmed',
        body: `Your ${token} purchase has been confirmed.`,
      };
    case 'TX_FAILED':
      return {
        title: 'Trade Failed',
        body: [
          `Your ${token} transaction could not be completed.`,
          '',
          `Reason: ${payload.reason ?? 'The transaction failed on-chain.'}`,
        ].join('\n'),
      };
    case 'TAKE_PROFIT':
      return {
        title: 'Take Profit Triggered',
        body: [
          token,
          '',
          `Entry: ${usd(payload.entryPrice)}`,
          `Current: ${usd(payload.currentPrice)}`,
          `Profit Target: ${signedPct(payload.takeProfitPct)}`,
          '',
          '[SELL NOW]',
        ].join('\n'),
      };
    case 'STOP_LOSS':
      return {
        title: 'Stop Loss Triggered',
        body: [
          token,
          '',
          `Entry: ${usd(payload.entryPrice)}`,
          `Current: ${usd(payload.currentPrice)}`,
          `Loss Threshold: ${signedPct(-(Math.abs(payload.stopLossPct ?? 0)))}`,
          '',
          '[SELL NOW]',
        ].join('\n'),
      };
    case 'SELL_SUBMITTED':
      return {
        title: 'Sell order submitted',
        body: `${token} sell has been submitted and is waiting for confirmation. This is not yet confirmed.`,
      };
    default:
      return { title: 'Trade update', body: token };
  }
}

export function formatTelegramTrade(payload: TradeEventPayload): { title: string; body: string } {
  const token = `$${payload.symbol}`;
  const asset = payload.assetClass === 'FOREX' ? payload.symbol : token;
  const mode = payload.executionMode ? ` (${payload.executionMode.toLowerCase()})` : '';
  switch (payload.kind) {
    case 'TRADE_SUCCEEDED':
      return {
        title: `✅ ${payload.side ?? 'TRADE'} SUCCESSFUL`,
        body: [
          `${asset}${mode}`,
          '',
          `${payload.side ?? 'Trade'} completed successfully.`,
          payload.amountUsd != null ? `Amount: ${usd(payload.amountUsd)}` : null,
          payload.tokenQuantity != null ? `Quantity: ${qty(payload.tokenQuantity)}` : null,
          payload.entryPrice != null || payload.exitPrice != null
            ? `Fill: ${usd(payload.entryPrice ?? payload.exitPrice)}`
            : null,
          payload.receivedUsd != null ? `Received: ${usd(payload.receivedUsd)}` : null,
          payload.pnlUsd != null ? `PnL: ${signedUsd(payload.pnlUsd)}` : null,
          payload.roiPct != null ? `ROI: ${signedPct(payload.roiPct)}` : null,
          payload.tradeId ? `Trade ID: ${payload.tradeId}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    case 'TRADE_FAILED':
      return {
        title: `❌ ${payload.side ?? 'TRADE'} FAILED`,
        body: [
          `${asset}${mode}`,
          '',
          `${payload.side ?? 'Trade'} was not completed.`,
          `Reason: ${payload.reason ?? 'The trade could not be completed.'}`,
          payload.tradeId ? `Trade ID: ${payload.tradeId}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    case 'TRADE_PROFIT':
      return {
        title: 'Success',
        body: [
          `${asset}${mode}`,
          '',
          'Trade finished with profit.',
          payload.side ? `Side: ${payload.side}` : null,
          payload.entryPrice != null ? `Entry: ${usd(payload.entryPrice)}` : null,
          payload.exitPrice != null ? `Exit: ${usd(payload.exitPrice)}` : null,
          payload.pnlUsd != null ? `Profit: ${signedUsd(payload.pnlUsd)}` : null,
          payload.roiPct != null ? `ROI: ${signedPct(payload.roiPct)}` : null,
          payload.reason ? `Reason: ${payload.reason}` : null,
          payload.tradeId ? `Trade ID: ${payload.tradeId}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    case 'TRADE_LOSS':
      return {
        title: 'Failure',
        body: [
          `${asset}${mode}`,
          '',
          'Trade finished with loss.',
          payload.side ? `Side: ${payload.side}` : null,
          payload.entryPrice != null ? `Entry: ${usd(payload.entryPrice)}` : null,
          payload.exitPrice != null ? `Exit: ${usd(payload.exitPrice)}` : null,
          payload.pnlUsd != null ? `Loss: ${signedUsd(payload.pnlUsd)}` : null,
          payload.roiPct != null ? `ROI: ${signedPct(payload.roiPct)}` : null,
          payload.reason ? `Reason: ${payload.reason}` : null,
          payload.tradeId ? `Trade ID: ${payload.tradeId}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    case 'BUY_CONFIRMED':
      return {
        title: '🟢 BUY CONFIRMED',
        body: [
          token,
          '',
          `Amount: ${usd(payload.amountUsd)}`,
          `Entry: ${usd(payload.entryPrice)}`,
          '',
          'Transaction confirmed.',
        ].join('\n'),
      };
    case 'SELL_CONFIRMED':
      return {
        title: '🔴 SELL CONFIRMED',
        body: [
          token,
          '',
          `PnL: ${signedUsd(payload.pnlUsd)}`,
          `ROI: ${signedPct(payload.roiPct)}`,
          '',
          'Transaction confirmed.',
        ].join('\n'),
      };
    case 'TAKE_PROFIT':
      return {
        title: '⚠️ TAKE PROFIT',
        body: [
          `${token} has reached your configured target.`,
          '',
          `Current ROI: ${signedPct(payload.roiPct)}`,
          '',
          '[OPEN TRADE]',
        ].join('\n'),
      };
    case 'STOP_LOSS':
      return {
        title: '⚠️ STOP LOSS',
        body: [
          `${token} has reached your stop-loss threshold.`,
          '',
          `Current ROI: ${signedPct(payload.roiPct)}`,
          '',
          '[OPEN TRADE]',
        ].join('\n'),
      };
    case 'TX_PENDING':
      return {
        title: '⏳ TRADE PENDING',
        body: `${token} transaction submitted. Waiting for confirmation.`,
      };
    case 'TX_FAILED':
      return {
        title: '❌ TRADE FAILED',
        body: `${token}\n\n${payload.reason ?? 'The transaction could not be completed.'}`,
      };
    case 'SELL_SUBMITTED':
      return {
        title: '📤 SELL SUBMITTED',
        body: `${token} sell order submitted — not confirmed yet.`,
      };
    default:
      return formatTradeEvent(payload);
  }
}

export function eventTypeForKind(
  kind: TradeEventKind,
):
  | 'BUY'
  | 'SELL'
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'TX_PENDING'
  | 'TX_CONFIRMED'
  | 'TX_FAILED'
  | 'TRADE' {
  switch (kind) {
    case 'BUY_CONFIRMED':
      return 'BUY';
    case 'SELL_CONFIRMED':
      return 'SELL';
    case 'TAKE_PROFIT':
      return 'TAKE_PROFIT';
    case 'STOP_LOSS':
      return 'STOP_LOSS';
    case 'TX_PENDING':
      return 'TX_PENDING';
    case 'TX_CONFIRMED':
      return 'TX_CONFIRMED';
    case 'TX_FAILED':
      return 'TX_FAILED';
    case 'SELL_SUBMITTED':
      return 'SELL';
    case 'TRADE_PROFIT':
    case 'TRADE_LOSS':
      return 'TRADE';
    default:
      return 'TRADE';
  }
}

export function completionKindForPnl(
  pnlUsd: number | undefined,
): 'TRADE_PROFIT' | 'TRADE_LOSS' | null {
  if (pnlUsd == null || !Number.isFinite(pnlUsd)) return null;
  return pnlUsd > 0 ? 'TRADE_PROFIT' : 'TRADE_LOSS';
}
