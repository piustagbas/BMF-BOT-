import { describe, expect, it } from 'vitest';
import { mapRugcheckReport } from './token-security';
import { parseMintAuthoritiesFromBase64 } from './mint-authorities';

describe('mapRugcheckReport', () => {
  it('maps holders risks and authorities', () => {
    const report = mapRugcheckReport('Token1111111111111111111111111111111111111', {
      mintAuthority: null,
      freezeAuthority: null,
      creator: 'Creator111',
      creatorBalance: 100,
      totalMarketLiquidity: 50000,
      score_normalised: 80,
      tokenMeta: { mutable: true },
      topHolders: [
        { address: 'A', pct: 12 },
        { address: 'B', pct: 10 },
        { address: 'C', pct: 8 },
      ],
      risks: [
        { name: 'Mutable metadata', level: 'warn', score: 100 },
        { name: 'Honeypot risk', level: 'danger', score: 1000 },
      ],
    });

    expect(report.mintAuthorityRevoked).toBe(true);
    expect(report.freezeAuthorityRevoked).toBe(true);
    expect(report.top10Pct).toBeCloseTo(30);
    expect(report.warnRiskCount).toBe(1);
    expect(report.dangerRiskCount).toBe(1);
    expect(report.criticalFlags.some((f) => /Honeypot/i.test(f))).toBe(true);
  });
});

describe('parseMintAuthoritiesFromBase64', () => {
  it('detects revoked authorities', () => {
    const buf = Buffer.alloc(82, 0);
    // mintAuthorityOption = 0, freezeAuthorityOption = 0
    const parsed = parseMintAuthoritiesFromBase64(buf.toString('base64'));
    expect(parsed.mintAuthorityRevoked).toBe(true);
    expect(parsed.freezeAuthorityRevoked).toBe(true);
  });

  it('detects active mint authority', () => {
    const buf = Buffer.alloc(82, 0);
    buf.writeUInt32LE(1, 0); // mint authority present
    buf.writeUInt32LE(0, 46); // freeze revoked
    const parsed = parseMintAuthoritiesFromBase64(buf.toString('base64'));
    expect(parsed.mintAuthorityRevoked).toBe(false);
    expect(parsed.freezeAuthorityRevoked).toBe(true);
  });
});
