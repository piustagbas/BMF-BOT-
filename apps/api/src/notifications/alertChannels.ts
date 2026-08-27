export const BUY_ALERT_DEDUPE_MS = 45 * 60 * 1000;

export type ChannelFlags = {
  notifyBuySetups: boolean;
  telegramEnabled: boolean;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
};

export type ConfiguredChannels = {
  telegram: boolean;
  email: boolean;
  whatsapp: boolean;
};

/** In-memory settings after API restart are stale; env + Mongo must decide delivery. */
export function mergeChannelFlags(opts: {
  memory: ChannelFlags;
  persisted: ChannelFlags | null;
  configured: ConfiguredChannels;
}): ChannelFlags {
  const src = opts.persisted ?? opts.memory;
  const notifyBuySetups = src.notifyBuySetups !== false;
  if (!opts.persisted) {
    return {
      notifyBuySetups,
      telegramEnabled: Boolean(opts.memory.telegramEnabled || opts.configured.telegram),
      emailEnabled: Boolean(opts.memory.emailEnabled || opts.configured.email),
      whatsappEnabled: Boolean(opts.memory.whatsappEnabled || opts.configured.whatsapp),
    };
  }
  return {
    notifyBuySetups,
    telegramEnabled: Boolean(src.telegramEnabled),
    emailEnabled: Boolean(src.emailEnabled),
    whatsappEnabled: Boolean(src.whatsappEnabled),
  };
}

export function activeAlertChannels(
  flags: ChannelFlags,
  configured: ConfiguredChannels,
): Array<'telegram' | 'email' | 'whatsapp'> {
  const out: Array<'telegram' | 'email' | 'whatsapp'> = [];
  if (configured.telegram && flags.telegramEnabled) out.push('telegram');
  if (configured.email && flags.emailEnabled) out.push('email');
  if (configured.whatsapp && flags.whatsappEnabled) out.push('whatsapp');
  return out;
}

export function shouldSkipBuyAlert(
  lastSentAt: number | undefined,
  now: number,
  windowMs = BUY_ALERT_DEDUPE_MS,
): boolean {
  return lastSentAt != null && now - lastSentAt < windowMs;
}

export function healPatchForConfigured(configured: ConfiguredChannels): Partial<ChannelFlags> {
  const patch: Partial<ChannelFlags> = {};
  if (configured.telegram) patch.telegramEnabled = true;
  if (configured.email) patch.emailEnabled = true;
  if (configured.whatsapp) patch.whatsappEnabled = true;
  return patch;
}
