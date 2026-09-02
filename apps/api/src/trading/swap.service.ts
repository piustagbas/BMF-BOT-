import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ConnectedWallet,
  TpslOrder,
  UserPosition,
  UserTrade,
  isDbConnected,
  type IUser,
  type IUserTrade,
  type TradeSide,
  type TradeStatus,
} from '@memecoinbot/db';
import {
  SOL_MINT,
  buildJupiterSwapTransaction,
  fetchDexScreenerToken,
  fetchJupiterPrice,
  fetchJupiterSwapQuote,
  getSolBalanceLamports,
  getSplTokenUiBalance,
  getTokenDecimals,
  waitForSignatureConfirmation,
} from '@memecoinbot/data-providers';
import { looksLikeSolanaAddress } from '@memecoinbot/shared';
import { SettingsService } from '../settings/settings.service';
import { TradeNotificationsService } from '../notifications/trade-notifications.service';
import { completionKindForPnl } from '../notifications/trade-events';
import {
  canCollectOnChain,
  feeAccountForSwap,
  platformFeeUsd,
  readPlatformFeeConfig,
} from './platform-fee';
import { mapProviderError, safeSwapMessage, type SwapErrorCode } from './swap.errors';
import {
  applyPercent,
  atomicToUi,
  buildQuoteBreakdown,
  canSubmitStatus,
  computeAvgEntry,
  estimateNetworkFeeUsd,
  isTerminalStatus,
  lamportsToUsd,
  reducePosition,
  uiToAtomic,
  unrealizedPnl,
  usdToSolLamports,
  validateAmountUsd,
  validateMint,
  validateWallet,
} from './swap.logic';
import { stopLossPrice, takeProfitPrice } from './tpsl.logic';

type PreparedQuote = {
  raw: Record<string, unknown>;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: number | null;
  slippageBps: number;
};

@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);
  private readonly quotes = new Map<string, PreparedQuote>();
  private readonly inFlight = new Set<string>();
  private readonly memoryTrades = new Map<string, Record<string, unknown>>();

  constructor(
    private readonly settings: SettingsService,
    private readonly tradeNotes: TradeNotificationsService,
  ) {}

  feeConfig() {
    return readPlatformFeeConfig();
  }

  async connectWallet(
    user: IUser,
    body: { address: string; provider?: 'phantom' | 'solflare' | 'manual' },
  ) {
    const address = body.address?.trim();
    if (!looksLikeSolanaAddress(address)) {
      throw new BadRequestException(safeSwapMessage('INVALID_WALLET'));
    }
    await this.settings.hydrateFromUser(user);
    this.settings.updateSettings({
      walletPublicKey: address,
      walletProvider: body.provider ?? 'manual',
    } as Parameters<SettingsService['updateSettings']>[0]);
    await this.settings.persistToUser(user);
    if (isDbConnected()) {
      await ConnectedWallet.findOneAndUpdate(
        { userId: user._id, address },
        {
          userId: user._id,
          address,
          provider: body.provider ?? 'manual',
          disconnectedAt: null,
          connectedAt: new Date(),
        },
        { upsert: true },
      );
    }
    return this.getWallet(user, address);
  }

  async disconnectWallet(user: IUser) {
    await this.settings.hydrateFromUser(user);
    const prev = this.settings.getSettings().walletPublicKey;
    this.settings.updateSettings({
      walletPublicKey: null,
      walletProvider: null,
    } as Parameters<SettingsService['updateSettings']>[0]);
    await this.settings.persistToUser(user);
    if (isDbConnected() && prev) {
      await ConnectedWallet.updateMany(
        { userId: user._id, address: prev },
        { $set: { disconnectedAt: new Date() } },
      );
    }
    return { connected: false, address: null };
  }

  async getWallet(user: IUser, addressOverride?: string) {
    await this.settings.hydrateFromUser(user);
    const address =
      addressOverride ?? this.settings.getSettings().walletPublicKey ?? null;
    const provider =
      (this.settings.getSettings() as { walletProvider?: string | null }).walletProvider ??
      'manual';
    if (!address) {
      return {
        connected: false,
        address: null,
        provider: null,
        solBalance: 0,
        solBalanceUsd: 0,
        network: 'solana',
      };
    }
    const [sol, solPrice] = await Promise.all([
      getSolBalanceLamports(address),
      this.solPriceUsd(),
    ]);
    const lamports = sol.ok && sol.data != null ? sol.data : 0;
    const solBal = lamports / 1e9;
    return {
      connected: true,
      address,
      provider,
      solBalance: solBal,
      solBalanceUsd: solBal * solPrice,
      network: 'solana',
      router: 'jupiter',
    };
  }

  async quote(
    user: IUser,
    body: {
      side: TradeSide;
      tokenAddress: string;
      amountUsd?: number;
      amountToken?: number;
      percent?: number;
      slippageBps?: number;
      wallet?: string;
    },
  ) {
    const mintErr = validateMint(body.tokenAddress);
    if (mintErr) throw new BadRequestException(safeSwapMessage(mintErr));

    await this.settings.hydrateFromUser(user);
    if (this.settings.getSettings().emergencyStop) {
      throw new BadRequestException(safeSwapMessage('EMERGENCY_STOP'));
    }

    const wallet =
      body.wallet?.trim() || this.settings.getSettings().walletPublicKey || null;
    const walletErr = validateWallet(wallet);
    if (walletErr) throw new BadRequestException(safeSwapMessage(walletErr));

    const settings = this.settings.getSettings();
    const slippageBps = Math.max(
      10,
      Math.min(body.slippageBps ?? Math.min(settings.maxSlippageBps, 100), 2000),
    );
    const fee = this.feeConfig();
    const [solPrice, tokenSnap, decimalsRes, solBal, tokenBal] = await Promise.all([
      this.solPriceUsd(),
      fetchDexScreenerToken(body.tokenAddress),
      getTokenDecimals(body.tokenAddress),
      getSolBalanceLamports(wallet!),
      getSplTokenUiBalance(wallet!, body.tokenAddress),
    ]);

    const snap = tokenSnap.ok ? tokenSnap.data : null;
    const currentPrice = snap?.priceUsd ?? null;
    const decimals = decimalsRes.ok && decimalsRes.data != null ? decimalsRes.data : 6;
    const solLamports = solBal.ok && solBal.data != null ? solBal.data : 0;
    const solUi = solLamports / 1e9;
    const tokenUi = tokenBal.ok && tokenBal.data ? tokenBal.data.uiAmount : 0;
    const tokenAtomic = tokenBal.ok && tokenBal.data ? tokenBal.data.amount : '0';

    const side = body.side === 'SELL' ? 'SELL' : 'BUY';
    let amountUsd = body.amountUsd ?? 0;
    let amountToken = body.amountToken ?? 0;

    if (body.percent != null) {
      if (side === 'BUY') {
        amountUsd = applyPercent(solUi * solPrice, body.percent);
      } else {
        amountToken = applyPercent(tokenUi, body.percent);
        amountUsd = currentPrice ? amountToken * currentPrice : 0;
      }
    } else if (side === 'SELL' && amountToken > 0 && currentPrice) {
      amountUsd = amountToken * currentPrice;
    } else if (side === 'BUY' && amountUsd > 0) {
      /* ok */
    } else if (side === 'SELL' && amountUsd > 0 && currentPrice) {
      amountToken = amountUsd / currentPrice;
    }

    const amtErr = validateAmountUsd(amountUsd);
    if (amtErr) throw new BadRequestException(safeSwapMessage(amtErr));

    if (side === 'BUY') {
      const needed = usdToSolLamports(amountUsd, solPrice);
      if (needed > BigInt(solLamports)) {
        throw new BadRequestException(safeSwapMessage('INSUFFICIENT_BALANCE'));
      }
    } else if (amountToken > tokenUi + 1e-12) {
      throw new BadRequestException(safeSwapMessage('INSUFFICIENT_BALANCE'));
    }

    if (side === 'SELL' && tokenUi <= 0) {
      throw new BadRequestException(
        'SELL blocked: you do not hold this token in the connected wallet.',
      );
    }
    if (side === 'SELL' && (snap?.liquidityUsd ?? 0) < 10_000) {
      throw new BadRequestException(
        'SELL blocked: liquidity is too thin to exit safely.',
      );
    }

    const platformOnChain = canCollectOnChain(fee);
    const swapUsd = amountUsd;
    const inAtomic =
      side === 'BUY'
        ? usdToSolLamports(swapUsd, solPrice).toString()
        : amountToken > 0
          ? uiToAtomic(amountToken, decimals)
          : tokenAtomic;

    if (inAtomic === '0') {
      throw new BadRequestException(safeSwapMessage('INVALID_AMOUNT'));
    }

    const inputMint = side === 'BUY' ? SOL_MINT : body.tokenAddress;
    const outputMint = side === 'BUY' ? body.tokenAddress : SOL_MINT;
    const swapQuote = await fetchJupiterSwapQuote({
      inputMint,
      outputMint,
      amountAtomic: inAtomic,
      slippageBps,
      platformFeeBps: platformOnChain ? fee.bps : undefined,
    });

    if (!swapQuote.ok || !swapQuote.data) {
      const mapped = mapProviderError(swapQuote.error);
      throw new BadRequestException(mapped.message);
    }

    if (
      side === 'SELL' &&
      swapQuote.data.priceImpactPct != null &&
      swapQuote.data.priceImpactPct > 8
    ) {
      throw new BadRequestException(
        `SELL blocked: price impact ${swapQuote.data.priceImpactPct.toFixed(1)}% is too high.`,
      );
    }

    const outUi = atomicToUi(
      swapQuote.data.outAmount,
      side === 'BUY' ? decimals : 9,
    );
    const minUi = atomicToUi(
      swapQuote.data.otherAmountThreshold,
      side === 'BUY' ? decimals : 9,
    );
    const estimatedReceivedUsd =
      side === 'BUY' ? (currentPrice ? outUi * currentPrice : amountUsd) : outUi * solPrice;
    const networkFeeUsd = estimateNetworkFeeUsd(solPrice);
    const breakdown = buildQuoteBreakdown({
      amountUsd,
      platformFeeBps: fee.bps,
      networkFeeUsd,
      estimatedReceived: outUi,
      minimumReceived: minUi,
      priceImpactPct: swapQuote.data.priceImpactPct,
      currentPrice,
    });

    return {
      side,
      tokenAddress: body.tokenAddress,
      contractAddress: body.tokenAddress,
      symbol: snap?.symbol ?? 'TOKEN',
      name: snap?.name ?? 'Token',
      logo: snap?.imageUrl ?? null,
      marketCap: snap?.marketCap ?? null,
      liquidityUsd: snap?.liquidityUsd ?? null,
      volume24h: snap?.volume24h ?? null,
      priceChange24h: snap?.priceChange24h ?? null,
      dexId: snap?.dexId ?? null,
      pairAddress: snap?.pairAddress ?? null,
      network: 'solana',
      router: 'jupiter',
      tradingPair: `${snap?.symbol ?? 'TOKEN'}/SOL`,
      wallet,
      walletBalanceSol: solUi,
      walletBalanceSolUsd: solUi * solPrice,
      walletBalanceToken: tokenUi,
      ...breakdown,
      amountToken: side === 'BUY' ? outUi : amountToken,
      slippageBps,
      platformFeeOnChain: platformOnChain,
      platformFeeNote: platformOnChain
        ? `App fee ${fee.bps / 100}% is taken on this swap and paid to the app owner. That is not Solana gas — gas goes to the network.`
        : 'App fee is listed here. Set PLATFORM_FEE_WALLET (your Solana address) in the server .env to collect it on-chain.',
      estimatedTokensReceived: side === 'BUY' ? outUi : undefined,
      estimatedProceedsUsd: side === 'SELL' ? estimatedReceivedUsd : undefined,
      estimatedProceedsSol: side === 'SELL' ? outUi : undefined,
      inAmount: swapQuote.data.inAmount,
      outAmount: swapQuote.data.outAmount,
      quote: swapQuote.data.raw,
      solPriceUsd: solPrice,
    };
  }

  async prepare(
    user: IUser,
    body: {
      side: TradeSide;
      tokenAddress: string;
      amountUsd?: number;
      amountToken?: number;
      percent?: number;
      slippageBps?: number;
      wallet?: string;
      takeProfitPct?: number | null;
      stopLossPct?: number | null;
      idempotencyKey?: string;
      confirmRealMoney?: boolean;
    },
  ) {
    if (!body.confirmRealMoney) {
      throw new BadRequestException(
        'confirmRealMoney=true required. Trading can result in financial loss.',
      );
    }
    const quoted = await this.quote(user, body);
    const fee = this.feeConfig();
    const wallet = quoted.wallet as string;

    const built = await buildJupiterSwapTransaction({
      quoteResponse: quoted.quote as Record<string, unknown>,
      userPublicKey: wallet,
      feeAccount: feeAccountForSwap(fee),
      prioritizationFeeLamports: 'auto',
    });
    if (!built.ok || !built.data) {
      const mapped = mapProviderError(built.error);
      throw new BadRequestException(mapped.message);
    }

    const id = `swap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const doc = {
      userId: user._id,
      wallet,
      tokenAddress: quoted.tokenAddress,
      contractAddress: quoted.contractAddress,
      symbol: quoted.symbol,
      name: quoted.name,
      side: quoted.side,
      status: 'AWAITING_WALLET' as TradeStatus,
      amountUsd: quoted.amountUsd,
      tokenQuantity: quoted.side === 'BUY' ? quoted.estimatedReceived : quoted.amountToken,
      entryPrice: quoted.side === 'BUY' ? quoted.currentPrice : null,
      exitPrice: quoted.side === 'SELL' ? quoted.currentPrice : null,
      platformFeeUsd: quoted.platformFeeUsd,
      networkFeeUsd: quoted.networkFeeUsd,
      slippageBps: quoted.slippageBps,
      priceImpactPct: quoted.priceImpactPct,
      minReceived: String(quoted.minimumReceived),
      estimatedReceived: String(quoted.estimatedReceived),
      txSignature: null,
      idempotencyKey: body.idempotencyKey?.trim() || id,
      errorCode: null,
      errorMessage: null,
      takeProfitPct: body.takeProfitPct ?? null,
      stopLossPct: body.stopLossPct ?? null,
      dexId: quoted.dexId,
      pairAddress: quoted.pairAddress,
      network: 'solana',
      router: 'jupiter',
      confirmedAt: null,
      submittedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    let tradeId = id;
    if (isDbConnected()) {
      try {
        const created = await UserTrade.create(doc);
        tradeId = String(created._id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (/duplicate|e11000/i.test(msg)) {
          throw new BadRequestException(safeSwapMessage('DUPLICATE'));
        }
        this.logger.warn(`Trade persist failed, using memory: ${msg}`);
        this.memoryTrades.set(id, { ...doc, id });
      }
    } else {
      this.memoryTrades.set(id, { ...doc, id });
    }

    this.quotes.set(tradeId, {
      raw: quoted.quote as Record<string, unknown>,
      inputMint: quoted.side === 'BUY' ? SOL_MINT : quoted.tokenAddress,
      outputMint: quoted.side === 'BUY' ? quoted.tokenAddress : SOL_MINT,
      inAmount: quoted.inAmount,
      outAmount: quoted.outAmount,
      otherAmountThreshold: String(quoted.minimumReceived),
      priceImpactPct: quoted.priceImpactPct,
      slippageBps: quoted.slippageBps,
    });

    return {
      id: tradeId,
      status: 'AWAITING_WALLET' as TradeStatus,
      unsignedSwapTx: built.data.swapTransaction,
      lastValidBlockHeight: built.data.lastValidBlockHeight,
      quote: quoted,
      takeProfitPct: body.takeProfitPct ?? null,
      stopLossPct: body.stopLossPct ?? null,
      states: ['PREPARING', 'AWAITING_WALLET', 'SUBMITTED', 'PENDING', 'CONFIRMED'],
      note: 'Sign in your wallet. Success is shown only after on-chain confirmation.',
    };
  }

  async submit(
    user: IUser,
    id: string,
    body: { signature: string; idempotencyKey?: string },
  ) {
    const sig = body.signature?.trim();
    if (!sig || sig.length < 32) {
      throw new BadRequestException('Valid transaction signature required');
    }
    const lockKey = `${id}:${sig}`;
    if (this.inFlight.has(lockKey) || this.inFlight.has(id)) {
      throw new BadRequestException(safeSwapMessage('DUPLICATE'));
    }
    this.inFlight.add(lockKey);
    this.inFlight.add(id);

    try {
      const trade = await this.loadTrade(user, id);
      if (isTerminalStatus(trade.status)) {
        if (trade.txSignature === sig && trade.status === 'CONFIRMED') {
          return this.publicTrade(trade);
        }
        throw new BadRequestException(safeSwapMessage('DUPLICATE'));
      }
      if (!canSubmitStatus(trade.status) && trade.status !== 'SUBMITTED' && trade.status !== 'PENDING') {
        throw new BadRequestException(`Cannot submit from status ${trade.status}`);
      }
      if (trade.txSignature && trade.txSignature !== sig) {
        throw new BadRequestException(safeSwapMessage('DUPLICATE'));
      }

      trade.status = 'SUBMITTED';
      trade.txSignature = sig;
      trade.submittedAt = new Date();
      await this.saveTrade(trade);

      await this.tradeNotes.emit(user, {
        kind: 'TX_PENDING',
        eventId: `pending:${sig}`,
        symbol: trade.symbol,
        tokenAddress: trade.tokenAddress,
        tradeId: String(trade._id ?? id),
      });

      trade.status = 'PENDING';
      await this.saveTrade(trade);

      const confirmed = await waitForSignatureConfirmation(sig, {
        timeoutMs: 18_000,
        intervalMs: 2000,
      });

      if (!confirmed.ok) {
        const mapped = mapProviderError(confirmed.error);
        return this.publicTrade(trade, mapped.message);
      }

      if (confirmed.data?.status === 'failed') {
        return this.failTrade(user, trade, 'TX_FAILED', safeSwapMessage('TX_FAILED'));
      }

      if (confirmed.data?.status === 'confirmed') {
        return this.confirmTrade(user, trade);
      }

      await this.saveTrade(trade);
      return this.publicTrade(trade);
    } finally {
      this.inFlight.delete(lockKey);
      this.inFlight.delete(id);
    }
  }

  async refreshStatus(user: IUser, id: string) {
    const trade = await this.loadTrade(user, id);
    if (trade.status === 'PENDING' || trade.status === 'SUBMITTED') {
      if (!trade.txSignature) return this.publicTrade(trade);
      const confirmed = await waitForSignatureConfirmation(trade.txSignature, {
        timeoutMs: 6_000,
        intervalMs: 1500,
      });
      if (confirmed.ok && confirmed.data?.status === 'confirmed') {
        return this.confirmTrade(user, trade);
      }
      if (confirmed.ok && confirmed.data?.status === 'failed') {
        return this.failTrade(user, trade, 'TX_FAILED', safeSwapMessage('TX_FAILED'));
      }
    }
    return this.publicTrade(trade);
  }

  async reject(user: IUser, id: string, reason?: string) {
    const trade = await this.loadTrade(user, id);
    if (isTerminalStatus(trade.status)) return this.publicTrade(trade);
    const mapped = mapProviderError(reason);
    return this.failTrade(
      user,
      trade,
      mapped.code === 'TX_FAILED' ? 'TX_REJECTED' : mapped.code,
      mapped.code === 'TX_REJECTED' ? safeSwapMessage('TX_REJECTED') : mapped.message,
      'REJECTED',
    );
  }

  async listTrades(user: IUser, limit = 50) {
    if (!isDbConnected()) {
      const items = [...this.memoryTrades.values()].slice(0, limit);
      return { items, count: items.length };
    }
    const items = await UserTrade.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .lean();
    return {
      items: items.map((t) => this.publicTrade(t as unknown as IUserTrade)),
      count: items.length,
    };
  }

  async listPositions(user: IUser) {
    if (!isDbConnected()) return { items: [], count: 0 };
    const open = await UserPosition.find({ userId: user._id, status: 'OPEN' }).lean();
    const items = await Promise.all(
      open.map(async (p) => {
        const snap = await fetchDexScreenerToken(p.tokenAddress);
        const price = snap.ok && snap.data?.priceUsd != null ? snap.data.priceUsd : p.lastPrice ?? p.avgEntry;
        const u = unrealizedPnl(p.qty, p.avgEntry, price ?? 0);
        return {
          id: String(p._id),
          tokenAddress: p.tokenAddress,
          symbol: p.symbol,
          name: p.name,
          qty: p.qty,
          avgEntry: p.avgEntry,
          sizeUsd: p.qty * (price ?? 0),
          currentPrice: price,
          currentValue: u.valueUsd,
          unrealizedPnlUsd: u.pnlUsd,
          roiPct: u.roiPct,
          takeProfitPct: p.takeProfitPct,
          stopLossPct: p.stopLossPct,
          takeProfitPrice: p.takeProfitPrice,
          stopLossPrice: p.stopLossPrice,
          status: p.status,
          openedAt: p.openedAt,
        };
      }),
    );
    return { items, count: items.length };
  }

  async portfolio(user: IUser) {
    const [positions, trades, wallet] = await Promise.all([
      this.listPositions(user),
      this.listTrades(user, 20),
      this.getWallet(user),
    ]);
    const value = positions.items.reduce((s, p) => s + p.currentValue, 0);
    const pnl = positions.items.reduce((s, p) => s + p.unrealizedPnlUsd, 0);
    return {
      wallet,
      positions: positions.items,
      recentTrades: trades.items,
      totalValueUsd: value,
      unrealizedPnlUsd: pnl,
    };
  }

  async setPositionTpsl(
    user: IUser,
    positionId: string,
    body: { takeProfitPct?: number | null; stopLossPct?: number | null },
  ) {
    if (!isDbConnected()) throw new BadRequestException('Database unavailable');
    const pos = await UserPosition.findOne({ _id: positionId, userId: user._id, status: 'OPEN' });
    if (!pos) throw new NotFoundException('Position not found');
    if (body.takeProfitPct != null) {
      pos.takeProfitPct = Math.max(1, Math.min(1000, body.takeProfitPct));
      pos.takeProfitPrice = takeProfitPrice(pos.avgEntry, pos.takeProfitPct);
    }
    if (body.stopLossPct != null) {
      pos.stopLossPct = Math.max(1, Math.min(90, Math.abs(body.stopLossPct)));
      pos.stopLossPrice = stopLossPrice(pos.avgEntry, pos.stopLossPct);
    }
    await pos.save();
    if (pos.takeProfitPct) {
      await TpslOrder.findOneAndUpdate(
        { positionId: pos._id, kind: 'TAKE_PROFIT', status: 'ACTIVE' },
        {
          userId: user._id,
          positionId: pos._id,
          wallet: pos.wallet,
          tokenAddress: pos.tokenAddress,
          symbol: pos.symbol,
          kind: 'TAKE_PROFIT',
          mode: 'ALERT',
          triggerPct: pos.takeProfitPct,
          triggerPrice: pos.takeProfitPrice,
          entryPrice: pos.avgEntry,
          status: 'ACTIVE',
        },
        { upsert: true },
      );
    }
    if (pos.stopLossPct) {
      await TpslOrder.findOneAndUpdate(
        { positionId: pos._id, kind: 'STOP_LOSS', status: 'ACTIVE' },
        {
          userId: user._id,
          positionId: pos._id,
          wallet: pos.wallet,
          tokenAddress: pos.tokenAddress,
          symbol: pos.symbol,
          kind: 'STOP_LOSS',
          mode: 'ALERT',
          triggerPct: pos.stopLossPct,
          triggerPrice: pos.stopLossPrice,
          entryPrice: pos.avgEntry,
          status: 'ACTIVE',
        },
        { upsert: true },
      );
    }
    return pos.toObject();
  }

  private async confirmTrade(user: IUser, trade: IUserTrade) {
    if (trade.status === 'CONFIRMED') return this.publicTrade(trade);
    const positionBefore = trade.side === 'SELL' && isDbConnected()
      ? await UserPosition.findOne({
          userId: user._id,
          tokenAddress: trade.tokenAddress,
          wallet: trade.wallet,
          status: 'OPEN',
        }).sort({ updatedAt: -1 })
      : null;
    trade.status = 'CONFIRMED';
    trade.confirmedAt = new Date();
    await this.saveTrade(trade);
    await this.applyPosition(user, trade);

    if (trade.side === 'SELL') {
      const pos = isDbConnected()
        ? await UserPosition.findOne({
            userId: user._id,
            tokenAddress: trade.tokenAddress,
            wallet: trade.wallet,
          }).sort({ updatedAt: -1 })
        : null;
      const pnl = pos?.realizedPnlUsd;
      const resultKind = completionKindForPnl(pnl) ?? 'TRADE_SUCCEEDED';
      const entryPrice = positionBefore?.avgEntry;
      const roi = entryPrice && trade.exitPrice
        ? ((trade.exitPrice - entryPrice) / entryPrice) * 100
        : undefined;
      await this.tradeNotes.emit(user, {
        kind: resultKind,
        eventId: `result:${trade.txSignature}`,
        symbol: trade.symbol,
        tokenAddress: trade.tokenAddress,
        side: trade.side,
        assetClass: 'MEMECOIN',
        executionMode: 'LIVE',
        amountUsd: trade.amountUsd,
        tokenQuantity: trade.tokenQuantity,
        receivedUsd: trade.amountUsd,
        pnlUsd: pnl ?? undefined,
        roiPct: roi,
        entryPrice,
        exitPrice: trade.exitPrice ?? undefined,
        tradeId: String(trade._id),
        txSignature: trade.txSignature,
      });
    } else {
      await this.tradeNotes.emit(user, {
        kind: 'TRADE_SUCCEEDED',
        eventId: `result:${trade.txSignature}`,
        symbol: trade.symbol,
        tokenAddress: trade.tokenAddress,
        side: trade.side,
        assetClass: 'MEMECOIN',
        executionMode: 'LIVE',
        amountUsd: trade.amountUsd,
        tokenQuantity: trade.tokenQuantity,
        entryPrice: trade.entryPrice ?? undefined,
        tradeId: String(trade._id),
        txSignature: trade.txSignature,
      });
    }
    this.quotes.delete(String(trade._id));
    return this.publicTrade(trade);
  }

  private async failTrade(
    user: IUser,
    trade: IUserTrade,
    code: SwapErrorCode,
    message: string,
    status: TradeStatus = 'FAILED',
  ) {
    trade.status = status;
    trade.errorCode = code;
    trade.errorMessage = message;
    await this.saveTrade(trade);
    await this.tradeNotes.emit(user, {
      kind: 'TRADE_FAILED',
      eventId: `result:${trade.txSignature ?? String(trade._id)}:${code}`,
      symbol: trade.symbol,
      tokenAddress: trade.tokenAddress,
      side: trade.side,
      assetClass: 'MEMECOIN',
      executionMode: 'LIVE',
      reason: message,
      tradeId: String(trade._id),
      txSignature: trade.txSignature,
    });
    return this.publicTrade(trade);
  }

  private async applyPosition(user: IUser, trade: IUserTrade) {
    if (!isDbConnected()) return;
    const price =
      (trade.side === 'BUY' ? trade.entryPrice : trade.exitPrice) ?? 0;
    const qty = trade.tokenQuantity;
    let pos = await UserPosition.findOne({
      userId: user._id,
      tokenAddress: trade.tokenAddress,
      wallet: trade.wallet,
      status: 'OPEN',
    });
    if (trade.side === 'BUY') {
      if (!pos) {
        pos = await UserPosition.create({
          userId: user._id,
          wallet: trade.wallet,
          tokenAddress: trade.tokenAddress,
          symbol: trade.symbol,
          name: trade.name,
          status: 'OPEN',
          qty,
          avgEntry: price,
          sizeUsd: qty * price,
          realizedPnlUsd: 0,
          takeProfitPct: trade.takeProfitPct,
          stopLossPct: trade.stopLossPct,
          takeProfitPrice: trade.takeProfitPct ? takeProfitPrice(price, trade.takeProfitPct) : null,
          stopLossPrice: trade.stopLossPct ? stopLossPrice(price, trade.stopLossPct) : null,
          lastPrice: price,
          lastTxSignature: trade.txSignature,
          openedAt: new Date(),
        });
      } else {
        const next = computeAvgEntry(pos.qty, pos.avgEntry, qty, price);
        pos.qty = next.qty;
        pos.avgEntry = next.avgEntry;
        pos.sizeUsd = next.qty * next.avgEntry;
        pos.lastPrice = price;
        pos.lastTxSignature = trade.txSignature;
        if (trade.takeProfitPct) {
          pos.takeProfitPct = trade.takeProfitPct;
          pos.takeProfitPrice = takeProfitPrice(next.avgEntry, trade.takeProfitPct);
        }
        if (trade.stopLossPct) {
          pos.stopLossPct = trade.stopLossPct;
          pos.stopLossPrice = stopLossPrice(next.avgEntry, trade.stopLossPct);
        }
        await pos.save();
      }
      if (pos.takeProfitPct || pos.stopLossPct) {
        await this.setPositionTpsl(user, String(pos._id), {
          takeProfitPct: pos.takeProfitPct,
          stopLossPct: pos.stopLossPct,
        });
      }
      return;
    }

    if (!pos) return;
    const next = reducePosition(pos.qty, pos.avgEntry, qty, price);
    pos.qty = next.qty;
    pos.avgEntry = next.avgEntry;
    pos.realizedPnlUsd += next.realizedPnlUsd;
    pos.sizeUsd = next.qty * next.avgEntry;
    pos.lastPrice = price;
    pos.lastTxSignature = trade.txSignature;
    if (next.qty <= 0) {
      pos.status = 'CLOSED';
      pos.closedAt = new Date();
      await TpslOrder.updateMany(
        { positionId: pos._id, status: 'ACTIVE' },
        { $set: { status: 'CANCELLED' } },
      );
    }
    await pos.save();
  }

  private async loadTrade(user: IUser, id: string): Promise<IUserTrade> {
    if (isDbConnected() && looksLikeObjectId(id)) {
      const doc = await UserTrade.findOne({ _id: id, userId: user._id });
      if (doc) return doc;
    }
    const mem = this.memoryTrades.get(id);
    if (mem) return mem as unknown as IUserTrade;
    throw new NotFoundException('Trade not found');
  }

  private async saveTrade(trade: IUserTrade) {
    trade.updatedAt = new Date();
    if (typeof (trade as { save?: () => Promise<unknown> }).save === 'function') {
      await (trade as { save: () => Promise<unknown> }).save();
      return;
    }
    const id = String((trade as { id?: string; _id?: unknown }).id ?? trade._id);
    this.memoryTrades.set(id, { ...(trade as unknown as Record<string, unknown>) });
  }

  private publicTrade(trade: IUserTrade | Record<string, unknown>, extra?: string) {
    const t = trade as IUserTrade & { id?: string };
    return {
      id: String(t._id ?? t.id),
      status: t.status,
      side: t.side,
      tokenAddress: t.tokenAddress,
      contractAddress: t.contractAddress,
      symbol: t.symbol,
      name: t.name,
      wallet: t.wallet,
      amountUsd: t.amountUsd,
      tokenQuantity: t.tokenQuantity,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      platformFeeUsd: t.platformFeeUsd,
      networkFeeUsd: t.networkFeeUsd,
      slippageBps: t.slippageBps,
      priceImpactPct: t.priceImpactPct,
      minReceived: t.minReceived,
      estimatedReceived: t.estimatedReceived,
      txSignature: t.txSignature,
      errorCode: t.errorCode,
      errorMessage: extra ?? t.errorMessage,
      takeProfitPct: t.takeProfitPct,
      stopLossPct: t.stopLossPct,
      dexId: t.dexId,
      pairAddress: t.pairAddress,
      network: t.network,
      router: t.router,
      confirmedAt: t.confirmedAt,
      submittedAt: t.submittedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      confirmed: t.status === 'CONFIRMED',
    };
  }

  private async solPriceUsd(): Promise<number> {
    const res = await fetchJupiterPrice(SOL_MINT, 9);
    if (res.ok && res.data?.priceUsd && res.data.priceUsd > 0) return res.data.priceUsd;
    return 150;
  }
}

function looksLikeObjectId(id: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(id);
}
