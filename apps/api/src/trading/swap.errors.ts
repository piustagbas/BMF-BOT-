export type SwapErrorCode =
  | 'WALLET_DISCONNECTED'
  | 'INSUFFICIENT_BALANCE'
  | 'INSUFFICIENT_LIQUIDITY'
  | 'SLIPPAGE_EXCEEDED'
  | 'TX_REJECTED'
  | 'TX_FAILED'
  | 'NETWORK_CONGESTION'
  | 'RPC_FAILURE'
  | 'PRICE_CHANGED'
  | 'UNSUPPORTED_TOKEN'
  | 'UNSUPPORTED_NETWORK'
  | 'INVALID_AMOUNT'
  | 'INVALID_ADDRESS'
  | 'INVALID_WALLET'
  | 'DUPLICATE'
  | 'EMERGENCY_STOP'
  | 'QUOTE_EXPIRED'
  | 'NOT_CONFIRMED';

const SAFE: Record<SwapErrorCode, string> = {
  WALLET_DISCONNECTED: 'Connect a wallet before trading.',
  INSUFFICIENT_BALANCE: 'Not enough balance for this trade.',
  INSUFFICIENT_LIQUIDITY: 'Not enough liquidity to complete this swap.',
  SLIPPAGE_EXCEEDED: 'Price moved beyond your slippage setting. Try again or increase slippage.',
  TX_REJECTED: 'The wallet rejected this transaction.',
  TX_FAILED: 'The blockchain transaction failed. No fill was confirmed.',
  NETWORK_CONGESTION: 'The network is congested. Wait a moment and try again.',
  RPC_FAILURE: 'Could not reach Solana RPC. Try again shortly.',
  PRICE_CHANGED: 'The price changed before execution. Review a fresh quote.',
  UNSUPPORTED_TOKEN: 'This token is not supported for in-app trading.',
  UNSUPPORTED_NETWORK: 'Only Solana tokens can be traded in-app.',
  INVALID_AMOUNT: 'Enter a valid trade amount.',
  INVALID_ADDRESS: 'That token address is not a valid Solana mint.',
  INVALID_WALLET: 'That wallet address is not valid.',
  DUPLICATE: 'This trade was already submitted.',
  EMERGENCY_STOP: 'Emergency stop is on. New trades are blocked.',
  QUOTE_EXPIRED: 'The quote expired. Request a new quote before confirming.',
  NOT_CONFIRMED: 'The transaction is still waiting for blockchain confirmation.',
};

export function safeSwapMessage(code: SwapErrorCode, fallback?: string): string {
  return SAFE[code] ?? fallback ?? 'This trade could not be completed.';
}

export function mapProviderError(raw: string | undefined | null): {
  code: SwapErrorCode;
  message: string;
} {
  const text = (raw ?? '').toLowerCase();
  if (!text) return { code: 'TX_FAILED', message: SAFE.TX_FAILED };

  if (/user rejected|rejected by user|denied|cancelled|canceled/.test(text)) {
    return { code: 'TX_REJECTED', message: SAFE.TX_REJECTED };
  }
  if (/insufficient.*(lamport|fund|balance|sol)|debit an account|insufficient funds/.test(text) || /0x1\b/.test(text)) {
    return { code: 'INSUFFICIENT_BALANCE', message: SAFE.INSUFFICIENT_BALANCE };
  }
  if (/no route|not enough.*liquidity|could not find.*route|token not tradable/.test(text)) {
    return { code: 'INSUFFICIENT_LIQUIDITY', message: SAFE.INSUFFICIENT_LIQUIDITY };
  }
  if (/slippage|0x1771|exceeded.*slippage|otheramountthreshold/.test(text)) {
    return { code: 'SLIPPAGE_EXCEEDED', message: SAFE.SLIPPAGE_EXCEEDED };
  }
  if (/429|rate limit|congest|blockhash not found|node is behind/.test(text)) {
    return { code: 'NETWORK_CONGESTION', message: SAFE.NETWORK_CONGESTION };
  }
  if (/rpc|fetch failed|econnrefused|etimedout|503|502|504/.test(text)) {
    return { code: 'RPC_FAILURE', message: SAFE.RPC_FAILURE };
  }
  if (/price.*changed|quote.*expir/.test(text)) {
    return { code: 'PRICE_CHANGED', message: SAFE.PRICE_CHANGED };
  }
  if (/unsupported.*mint|unknown token|invalid mint/.test(text)) {
    return { code: 'UNSUPPORTED_TOKEN', message: SAFE.UNSUPPORTED_TOKEN };
  }
  return { code: 'TX_FAILED', message: SAFE.TX_FAILED };
}
