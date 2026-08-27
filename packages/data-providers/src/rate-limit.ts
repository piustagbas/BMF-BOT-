export class SlidingWindowLimiter {
  private stamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
      if (this.stamps.length < this.max) {
        this.stamps.push(now);
        return;
      }
      const wait = this.windowMs - (now - this.stamps[0]!) + 20;
      await new Promise((r) => setTimeout(r, Math.max(50, wait)));
    }
  }
}

export const geckoLimiter = new SlidingWindowLimiter(18, 60_000);
export const heliusLimiter = new SlidingWindowLimiter(8, 1_000);
export const birdeyeLimiter = new SlidingWindowLimiter(10, 1_000);
