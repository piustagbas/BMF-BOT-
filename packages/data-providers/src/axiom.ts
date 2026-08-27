import type { ProviderResult, SourceHealth } from './types';

/**
 * Axiom integration placeholder.
 * Without a documented public API key/URL, we fail safely.
 */
export async function fetchAxiomToken(
  _address: string,
): Promise<ProviderResult<unknown>> {
  void _address;
  if (!process.env.AXIOM_API_URL || !process.env.AXIOM_API_KEY) {
    return {
      ok: false,
      unavailable: true,
      error: 'AXIOM DATA UNAVAILABLE',
    };
  }
  return {
    ok: false,
    unavailable: true,
    error: 'AXIOM DATA UNAVAILABLE',
  };
}

export async function pingAxiom(): Promise<SourceHealth> {
  if (!process.env.AXIOM_API_URL || !process.env.AXIOM_API_KEY) {
    return { status: 'OFFLINE', message: 'AXIOM DATA UNAVAILABLE' };
  }
  return { status: 'OFFLINE', message: 'AXIOM DATA UNAVAILABLE' };
}
