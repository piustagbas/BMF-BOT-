import { describe, expect, it } from 'vitest';
import { mapProviderError, safeSwapMessage } from './swap.errors';

describe('swap error mapping', () => {
  it('maps wallet rejection, slippage, liquidity, and balance without leaking internals', () => {
    expect(mapProviderError('User rejected the request').code).toBe('TX_REJECTED');
    expect(mapProviderError('No routes found').code).toBe('INSUFFICIENT_LIQUIDITY');
    expect(mapProviderError('Slippage tolerance exceeded').code).toBe('SLIPPAGE_EXCEEDED');
    expect(mapProviderError('Attempt to debit an account but found no record of a prior credit').code).toBe(
      'INSUFFICIENT_BALANCE',
    );
    expect(mapProviderError('429 Too Many Requests').code).toBe('NETWORK_CONGESTION');
    expect(safeSwapMessage('TX_FAILED')).not.toMatch(/mongo|stack|secret|private key/i);
  });
});
