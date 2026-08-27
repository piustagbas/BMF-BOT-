import { describe, expect, it } from 'vitest';
import { parseSplTokenAmount } from './smart-money';

describe('parseSplTokenAmount', () => {
  it('sums jsonParsed token accounts', () => {
    const amount = parseSplTokenAmount({
      value: [
        {
          account: {
            data: { parsed: { info: { tokenAmount: { uiAmount: 12.5 } } } },
          },
        },
        {
          account: {
            data: { parsed: { info: { tokenAmount: { uiAmount: 2 } } } },
          },
        },
      ],
    });
    expect(amount).toBe(14.5);
  });

  it('returns 0 when empty', () => {
    expect(parseSplTokenAmount({ value: [] })).toBe(0);
    expect(parseSplTokenAmount(null)).toBe(0);
  });
});
