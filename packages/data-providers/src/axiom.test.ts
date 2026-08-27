import { describe, expect, it } from 'vitest';
import { fetchAxiomToken } from './axiom';

describe('axiom fail-safe', () => {
  it('returns AXIOM DATA UNAVAILABLE without credentials', async () => {
    delete process.env.AXIOM_API_URL;
    delete process.env.AXIOM_API_KEY;
    const result = await fetchAxiomToken('Token1111111111111111111111111111111111111');
    expect(result.ok).toBe(false);
    expect(result.unavailable).toBe(true);
    expect(result.error).toBe('AXIOM DATA UNAVAILABLE');
  });
});
