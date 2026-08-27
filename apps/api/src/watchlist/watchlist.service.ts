import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { fetchDexScreenerToken } from '@memecoinbot/data-providers';
import { WatchlistItem, isDbConnected, type IUser } from '@memecoinbot/db';
import { DISCLAIMER } from '@memecoinbot/shared';

@Injectable()
export class WatchlistService {
  private ensureDb() {
    if (!isDbConnected()) {
      throw new ServiceUnavailableException(
        'MongoDB offline — start Mongo and set MONGODB_URI',
      );
    }
  }

  async list(user: IUser) {
    this.ensureDb();
    const docs = await WatchlistItem.find({ userId: user._id }).sort({
      createdAt: -1,
    });
    const items = docs.map((d) => ({
      address: d.address,
      symbol: d.symbol,
      name: d.name,
      imageUrl: d.imageUrl ?? null,
      notes: d.notes,
      priceUsd: d.priceUsd,
      liquidityUsd: d.liquidityUsd,
      priceChange24h: d.priceChange24h,
      addedAt: d.createdAt.toISOString(),
    }));
    return { items, count: items.length, disclaimer: DISCLAIMER };
  }

  async add(user: IUser, address: string, notes?: string) {
    this.ensureDb();
    const mint = address?.trim();
    if (!mint || mint.length < 32) {
      throw new BadRequestException('Valid token address required');
    }
    const market = await fetchDexScreenerToken(mint);
    if (!market.ok || !market.data) {
      throw new BadRequestException(market.error ?? 'Token not found');
    }

    const doc = await WatchlistItem.findOneAndUpdate(
      { userId: user._id, address: market.data.address },
      {
        userId: user._id,
        address: market.data.address,
        symbol: market.data.symbol,
        name: market.data.name,
        imageUrl: market.data.imageUrl ?? null,
        notes: notes?.trim() || null,
        priceUsd: market.data.priceUsd,
        liquidityUsd: market.data.liquidityUsd,
        priceChange24h: market.data.priceChange24h,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return {
      address: doc.address,
      symbol: doc.symbol,
      name: doc.name,
      imageUrl: doc.imageUrl ?? null,
      notes: doc.notes,
      priceUsd: doc.priceUsd,
      liquidityUsd: doc.liquidityUsd,
      priceChange24h: doc.priceChange24h,
      addedAt: doc.createdAt.toISOString(),
    };
  }

  async remove(user: IUser, address: string) {
    this.ensureDb();
    const res = await WatchlistItem.deleteOne({
      userId: user._id,
      address,
    });
    if (res.deletedCount === 0) {
      throw new NotFoundException('Watchlist item not found');
    }
    return { removed: true, address };
  }

  async has(user: IUser, address: string) {
    this.ensureDb();
    const found = await WatchlistItem.exists({ userId: user._id, address });
    return { address, watched: Boolean(found) };
  }

  async refresh(user: IUser) {
    this.ensureDb();
    const docs = await WatchlistItem.find({ userId: user._id });
    for (const doc of docs) {
      try {
        await this.add(user, doc.address, doc.notes ?? undefined);
      } catch {
        // keep stale
      }
    }
    return this.list(user);
  }
}
