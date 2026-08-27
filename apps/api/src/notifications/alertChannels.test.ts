import { describe, expect, it } from 'vitest';
import {
  activeAlertChannels,
  healPatchForConfigured,
  mergeChannelFlags,
  shouldSkipBuyAlert,
  type ChannelFlags,
} from './alertChannels';

const off: ChannelFlags = {
  notifyBuySetups: true,
  telegramEnabled: false,
  emailEnabled: false,
  whatsappEnabled: false,
};

describe('mergeChannelFlags', () => {
  it('turns on configured channels after restart when Mongo was never loaded', () => {
    const merged = mergeChannelFlags({
      memory: off,
      persisted: null,
      configured: { telegram: true, email: true, whatsapp: false },
    });
    expect(merged.telegramEnabled).toBe(true);
    expect(merged.emailEnabled).toBe(true);
    expect(merged.whatsappEnabled).toBe(false);
    expect(merged.notifyBuySetups).toBe(true);
  });

  it('honors an explicit mute saved in Mongo', () => {
    const merged = mergeChannelFlags({
      memory: { ...off, telegramEnabled: true, emailEnabled: true },
      persisted: { ...off, notifyBuySetups: true, telegramEnabled: false, emailEnabled: true },
      configured: { telegram: true, email: true, whatsapp: false },
    });
    expect(merged.telegramEnabled).toBe(false);
    expect(merged.emailEnabled).toBe(true);
  });
});

describe('activeAlertChannels', () => {
  it('does not enqueue Telegram when the bot is not configured', () => {
    expect(
      activeAlertChannels(
        { ...off, telegramEnabled: true, emailEnabled: true },
        { telegram: false, email: true, whatsapp: false },
      ),
    ).toEqual(['email']);
  });
});

describe('shouldSkipBuyAlert', () => {
  it('dedupes the same mint inside the window', () => {
    expect(shouldSkipBuyAlert(1_000, 1_000 + 10 * 60 * 1000)).toBe(true);
    expect(shouldSkipBuyAlert(1_000, 1_000 + 50 * 60 * 1000)).toBe(false);
    expect(shouldSkipBuyAlert(undefined, 1_000)).toBe(false);
  });
});

describe('healPatchForConfigured', () => {
  it('only enables channels that exist in env', () => {
    expect(healPatchForConfigured({ telegram: true, email: false, whatsapp: false })).toEqual({
      telegramEnabled: true,
    });
  });
});
