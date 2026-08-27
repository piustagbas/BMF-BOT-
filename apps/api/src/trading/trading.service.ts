import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  buildJupiterSwapTransaction,
  comparePrices,
  fetchJupiterPrice,
  fetchJupiterSwapQuote,
  getTokenDecimals,
  SOL_MINT,
} from '@memecoinbot/data-providers';
import { positionSizeUsd } from '@memecoinbot/risk';
import { runPreTradeChecks, type PreTradeCheckResult } from '@memecoinbot/pretrade';
import { DISCLAIMER, TradingMode } from '@memecoinbot/shared';
import { SignalsService } from '../signals/signals.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';

export type TradeProposalStatus =
  | 'PROPOSED'
  | 'CHECKS_FAILED'
  | 'USER_APPROVED'
  | 'PREPARED'
  | 'REJECTED'
  | 'RECORDED'
  | 'BLOCKED'
  | 'AUTO_DRY_RUN'
  | 'AUTO_BLOCKED';

export type TradeProposal = {
  id: string;
  status: TradeProposalStatus;
  source: 'MANUAL' | 'AUTO';
  side: 'BUY';
  tokenAddress: string;
  symbol: string;
  name: string;
  entryPrice: number;
  stopLoss: number;
  tp1Price: number;
  tp2Price: number;
  trailingMethod: string;
  positionSizeUsd: number;
  riskReward: number;
  safetyScore: number;
  signalScore: number;
  criticalWarning: boolean;
  liquidityUsd: number | null;
  jupiterQuoteOk: boolean;
  jupiterInAmount: string | null;
  jupiterOutAmount: string | null;
  priceImpactPct: number | null;
  slippageBps: number;
  dataConflict: boolean;
  conflictReason?: string;
  entryValid: boolean;
  preTrade: PreTradeCheckResult;
  unsignedSwapTx: string | null;
  txSignature: string | null;
  userApprovedAt: string | null;
  preparedAt: string | null;
  rejectedAt: string | null;
  recordedAt: string | null;
  beginner: {
    whatThisIs: string;
    whatYouMustDo: string;
    decision: string;
  };
  disclaimer: string;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class TradingService {
  private readonly logger = new Logger(TradingService.name);
  private readonly proposals: TradeProposal[] = [];
  private readonly recorded: TradeProposal[] = [];

  constructor(
    private readonly signals: SignalsService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  listProposals(limit = 30) {
    return {
      items: this.proposals.slice(0, Math.min(Math.max(limit, 1), 100)),
      count: this.proposals.length,
    };
  }

  listTrades(limit = 30) {
    const items = [...this.recorded, ...this.proposals.filter((p) => p.txSignature)]
      .slice(0, Math.min(Math.max(limit, 1), 100));
    return { items, count: items.length };
  }

  listPositions() {
    // Phase 9: open real positions only appear after recorded signatures
    const open = this.recorded.filter(
      (t) => t.status === 'RECORDED' && t.side === 'BUY' && t.txSignature,
    );
    return {
      items: open.map((t) => ({
        id: t.id,
        tokenAddress: t.tokenAddress,
        symbol: t.symbol,
        entryPrice: t.entryPrice,
        stopLoss: t.stopLoss,
        tp1Price: t.tp1Price,
        tp2Price: t.tp2Price,
        sizeUsd: t.positionSizeUsd,
        txSignature: t.txSignature,
        status: 'OPEN',
        openedAt: t.recordedAt,
      })),
      count: open.length,
      note: 'Real positions tracked after user-signed txs are recorded. No auto management yet.',
    };
  }

  getProposal(id: string): TradeProposal {
    const p = this.proposals.find((x) => x.id === id) ?? this.recorded.find((x) => x.id === id);
    if (!p) throw new NotFoundException(`Trade proposal ${id} not found`);
    return p;
  }

  async propose(
    address: string,
    opts?: {
      sizeUsd?: number;
      source?: 'MANUAL' | 'AUTO';
      preTradeMode?: 'MANUAL' | 'AUTO';
    },
  ): Promise<TradeProposal> {
    const settings = this.settings.getSettings();
    const risk = this.settings.getRisk();
    const source = opts?.source ?? 'MANUAL';
    const preTradeMode = opts?.preTradeMode ?? 'MANUAL';

    const signal = await this.signals.generateForAddress(address);
    if (signal.token.priceUsd == null || signal.token.priceUsd <= 0) {
      throw new BadRequestException('No usable price — cannot propose');
    }
    if (!signal.levels?.idealEntry) {
      throw new BadRequestException('Trade levels unavailable — cannot propose');
    }

    const accountBalance = risk.realAccountBalanceUsd;
    const size =
      opts?.sizeUsd ??
      positionSizeUsd({
        accountBalance,
        riskPct: risk.riskPerTradePct,
        entry: signal.levels.idealEntry,
        stopLoss: signal.levels.stopLoss,
        maxPositionPct: risk.maxPositionPct,
      });

    const decimalsRes = await getTokenDecimals(address);
    const decimals = decimalsRes.ok && decimalsRes.data != null ? decimalsRes.data : 6;

    // Size in SOL atomic for a rough buy quote (assume ~$150/SOL if we only have USD size)
    const solPriceHint = 150;
    const solAmount = Math.max(size / solPriceHint, 0.001);
    const lamports = BigInt(Math.floor(solAmount * 1e9)).toString();

    const [swapQuote, jupPrice] = await Promise.all([
      fetchJupiterSwapQuote({
        inputMint: SOL_MINT,
        outputMint: address,
        amountAtomic: lamports,
        slippageBps: settings.maxSlippageBps,
      }),
      fetchJupiterPrice(address, decimals),
    ]);

    const jupiterOk = Boolean(swapQuote.ok && swapQuote.data);
    const jupUsd =
      jupPrice.ok && jupPrice.data?.priceUsd != null ? jupPrice.data.priceUsd : null;
    const consensus = comparePrices(signal.token.priceUsd, jupUsd);

    const dexAgeSec = Math.max(
      0,
      (Date.now() - new Date(signal.generatedAt).getTime()) / 1000,
    );

    const isBuy = signal.signalType === 'BUY';
    const entryValid = Boolean(signal.levels.entryValid && isBuy);

    const preTrade = runPreTradeChecks({
      mode: preTradeMode,
      killSwitch: settings.killSwitch,
      emergencyStop: settings.emergencyStop,
      autoTradingEnabled: settings.autoTradingEnabled,
      walletAuthorized: Boolean(settings.walletPublicKey),
      safetyScore: signal.safetyScore,
      signalScore: signal.signalScore,
      safetyMin: risk.safetyMin,
      signalMin: risk.signalMin,
      criticalWarning: signal.criticalWarning ??
        signal.failedChecks.some((c) => c.toLowerCase().includes('critical')),
      liquidityUsd: signal.token.liquidityUsd,
      minLiquidityUsd: risk.minLiquidityUsd,
      axiomUnavailable: signal.axiomUnavailable,
      axiomRequiredForAutoTrading: settings.axiomRequiredForAutoTrading,
      dexDataAgeSec: dexAgeSec,
      jupiterQuoteOk: jupiterOk,
      slippageBps: settings.maxSlippageBps,
      maxSlippageBps: settings.maxSlippageBps,
      riskReward: signal.levels.riskReward,
      minRiskReward: risk.minRiskReward,
      positionSizeUsd: size,
      entryValid,
      dataConflict: consensus.conflict,
      riskLimits: {
        accountBalance,
        startingBalance: accountBalance,
        openPositions: this.listPositions().count,
        dailyTrades: this.proposals.filter(
          (p) => Date.now() - new Date(p.createdAt).getTime() < 86_400_000,
        ).length,
        dailyRealizedPnl: 0,
        consecutiveLosses: 0,
        currentExposureUsd: this.listPositions().items.reduce((s, p) => s + p.sizeUsd, 0),
        proposedSizeUsd: size,
        maxDailyLossPct: risk.maxDailyLossPct,
        maxOpenPositions: risk.maxOpenPositions,
        maxDailyTrades: risk.maxDailyTrades,
        maxExposurePct: risk.maxExposurePct,
        maxConsecutiveLosses: risk.maxConsecutiveLosses,
      },
    });

    if (!isBuy) {
      preTrade.allowed = false;
      preTrade.failed = [
        `Signal is ${signal.signalType} (BUY required to approve)`,
        ...preTrade.failed.filter((f) => f !== 'Entry still valid'),
      ];
      preTrade.checks.push({
        key: 'buy_signal',
        label: 'BUY signal required',
        passed: false,
        detail: `Got ${signal.signalType}`,
      });
    }

    const now = new Date().toISOString();
    const proposal: TradeProposal = {
      id: `trade_${Date.now()}_${this.proposals.length}`,
      status: preTrade.allowed
        ? 'PROPOSED'
        : source === 'AUTO'
          ? 'AUTO_BLOCKED'
          : 'CHECKS_FAILED',
      source,
      side: 'BUY',
      tokenAddress: signal.token.address,
      symbol: signal.token.symbol,
      name: signal.token.name,
      entryPrice: signal.levels.idealEntry,
      stopLoss: signal.levels.stopLoss,
      tp1Price: signal.levels.tp1Price,
      tp2Price: signal.levels.tp2Price,
      trailingMethod: risk.trailingMethod,
      positionSizeUsd: size,
      riskReward: signal.levels.riskReward,
      safetyScore: signal.safetyScore,
      signalScore: signal.signalScore,
      criticalWarning: false,
      liquidityUsd: signal.token.liquidityUsd,
      jupiterQuoteOk: jupiterOk,
      jupiterInAmount: swapQuote.data?.inAmount ?? null,
      jupiterOutAmount: swapQuote.data?.outAmount ?? null,
      priceImpactPct: swapQuote.data?.priceImpactPct ?? null,
      slippageBps: settings.maxSlippageBps,
      dataConflict: consensus.conflict,
      conflictReason: consensus.conflictReason,
      entryValid: signal.levels.entryValid,
      preTrade,
      unsignedSwapTx: null,
      txSignature: null,
      userApprovedAt: null,
      preparedAt: null,
      rejectedAt: null,
      recordedAt: null,
      beginner: {
        whatThisIs:
          source === 'AUTO'
            ? 'Auto-trading candidate. Server never holds private keys.'
            : 'A potential real-trade setup. The bot does not execute automatically.',
        whatYouMustDo:
          source === 'AUTO'
            ? 'Auto cycle uses dry-run or prepare-only. Sign any prepared tx in your wallet.'
            : 'Review levels, turn kill switch OFF only if you accept risk, set wallet pubkey, approve, then sign the unsigned Jupiter swap in your wallet.',
        decision: preTrade.allowed
          ? source === 'AUTO'
            ? 'Passed AUTO pre-trade filters — dry-run / prepare-only'
            : 'Passed configured filters — awaiting your manual approval'
          : `NO TRADE until checks pass: ${preTrade.failed.join('; ')}`,
      },
      disclaimer: DISCLAIMER,
      createdAt: now,
      updatedAt: now,
    };

    if (swapQuote.data) {
      this.quoteById.set(proposal.id, swapQuote.data.raw);
    }

    this.proposals.unshift(proposal);
    if (this.proposals.length > 100) this.proposals.length = 100;

    this.logger.log(
      `Proposed ${proposal.symbol} ${proposal.status} src=${source} size=$${size.toFixed(2)} checks=${preTrade.allowed}`,
    );
    return this.publicProposal(proposal);
  }

  private readonly quoteById = new Map<string, Record<string, unknown>>();

  private publicProposal(p: TradeProposal): TradeProposal {
    return { ...p };
  }

  async approve(id: string, body?: { confirmRealMoney?: boolean }): Promise<TradeProposal> {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) throw new NotFoundException(`Trade proposal ${id} not found`);
    if (p.status === 'REJECTED' || p.status === 'RECORDED') {
      throw new BadRequestException(`Cannot approve status ${p.status}`);
    }

    const settings = this.settings.getSettings();
    if (settings.tradingMode !== TradingMode.MANUAL_REAL) {
      throw new BadRequestException(
        'Set tradingMode to MANUAL_REAL before approving a real trade',
      );
    }
    if (!body?.confirmRealMoney) {
      throw new BadRequestException(
        'confirmRealMoney=true required. Trading can result in financial loss.',
      );
    }
    if (!p.preTrade.allowed) {
      throw new BadRequestException(
        `Pre-trade checks failed: ${p.preTrade.failed.join('; ')}`,
      );
    }
    if (settings.killSwitch) {
      throw new BadRequestException('KILL SWITCH ON — NO REAL TRADES');
    }
    if (settings.emergencyStop) {
      throw new BadRequestException('EMERGENCY STOP — new trades blocked');
    }

    const now = new Date().toISOString();
    p.status = 'USER_APPROVED';
    p.userApprovedAt = now;
    p.updatedAt = now;

    if (settings.notifyRealTrades) {
      await this.notifications.notify(
        `MANUAL APPROVED $${p.symbol}`,
        [
          'User approved a potential real trade (not auto-executed).',
          '',
          `Size: $${p.positionSizeUsd.toFixed(2)}`,
          `Entry: ${p.entryPrice}`,
          `SL: ${p.stopLoss}`,
          `TP1: ${p.tp1Price}`,
          `TP2: ${p.tp2Price}`,
          '',
          'Next: prepare unsigned Jupiter swap and sign in your wallet.',
          '',
          DISCLAIMER,
        ].join('\n'),
      );
    }

    return this.publicProposal(p);
  }

  reject(id: string): TradeProposal {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) throw new NotFoundException(`Trade proposal ${id} not found`);
    const now = new Date().toISOString();
    p.status = 'REJECTED';
    p.rejectedAt = now;
    p.updatedAt = now;
    return this.publicProposal(p);
  }

  async prepare(id: string): Promise<TradeProposal> {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) throw new NotFoundException(`Trade proposal ${id} not found`);
    if (p.status !== 'USER_APPROVED' && p.status !== 'PREPARED') {
      throw new BadRequestException(
        'Approve the trade first (USER_APPROVED) before preparing unsigned swap',
      );
    }

    const gate = this.settings.canPrepareRealTrade();
    if (!gate.ok) {
      throw new BadRequestException(gate.reason);
    }

    const quote = this.quoteById.get(id);
    if (!quote) {
      throw new BadRequestException(
        'Jupiter quote expired — propose again to refresh quote',
      );
    }

    const wallet = this.settings.getSettings().walletPublicKey!;
    const built = await buildJupiterSwapTransaction({
      quoteResponse: quote,
      userPublicKey: wallet,
    });
    if (!built.ok || !built.data) {
      throw new BadRequestException(built.error ?? 'Failed to build Jupiter swap');
    }

    const now = new Date().toISOString();
    p.status = 'PREPARED';
    p.unsignedSwapTx = built.data.swapTransaction;
    p.preparedAt = now;
    p.updatedAt = now;

    return {
      ...this.publicProposal(p),
      beginner: {
        ...p.beginner,
        whatYouMustDo:
          'Sign the unsignedSwapTx in your Solana wallet, then POST /trades/:id/record with the signature. Broadcast stays OFF unless REAL_TRADING_BROADCAST=true.',
      },
    };
  }

  record(id: string, body: { txSignature: string }): TradeProposal {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) throw new NotFoundException(`Trade proposal ${id} not found`);
    if (p.status !== 'PREPARED' && p.status !== 'USER_APPROVED' && p.status !== 'AUTO_DRY_RUN') {
      throw new BadRequestException(`Cannot record from status ${p.status}`);
    }
    const sig = body.txSignature?.trim();
    if (!sig || sig.length < 32) {
      throw new BadRequestException('Valid txSignature required');
    }

    const now = new Date().toISOString();
    p.status = 'RECORDED';
    p.txSignature = sig;
    p.recordedAt = now;
    p.updatedAt = now;
    this.recorded.unshift(p);
    return this.publicProposal(p);
  }

  /**
   * Auto path after pre-trade passes. Never broadcasts with a server private key.
   * dry_run → AUTO_DRY_RUN; prepare_only → PREPARED unsigned tx.
   */
  async autoAcceptProposal(
    id: string,
    opts: { executionMode: 'dry_run' | 'prepare_only' },
  ): Promise<TradeProposal> {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) throw new NotFoundException(`Trade proposal ${id} not found`);
    if (!p.preTrade.allowed) {
      throw new BadRequestException(
        `AUTO pre-trade failed: ${p.preTrade.failed.join('; ')}`,
      );
    }

    const gate = this.settings.canRunAutoCycle();
    if (!gate.ok) {
      throw new BadRequestException(gate.reason);
    }

    const now = new Date().toISOString();
    p.userApprovedAt = now;
    p.updatedAt = now;

    if (opts.executionMode === 'prepare_only') {
      const quote = this.quoteById.get(id);
      if (!quote) {
        throw new BadRequestException('Jupiter quote missing for auto prepare');
      }
      const wallet = this.settings.getSettings().walletPublicKey!;
      const built = await buildJupiterSwapTransaction({
        quoteResponse: quote,
        userPublicKey: wallet,
      });
      if (!built.ok || !built.data) {
        throw new BadRequestException(built.error ?? 'Auto prepare failed');
      }
      p.status = 'PREPARED';
      p.unsignedSwapTx = built.data.swapTransaction;
      p.preparedAt = now;
      p.beginner.decision =
        'AUTO prepare-only: unsigned swap ready — sign in wallet. Not broadcast.';
      return this.publicProposal(p);
    }

    p.status = 'AUTO_DRY_RUN';
    p.beginner.decision =
      'AUTO dry-run: all pre-trade checks passed — would execute if an external signer were connected. No chain tx sent.';
    return this.publicProposal(p);
  }
}
