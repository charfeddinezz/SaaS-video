import type { FreeAllowance, Period, SiteEntry } from './types.js';

/**
 * Tracks how much of each provider's free allowance has been consumed.
 *
 * Free allowances reset on wall-clock boundaries (day/week/month) in the
 * provider's own timezone, so the ledger takes a per-site UTC offset. This is
 * the piece that prevents the scheduler from burning a whole day's credits in
 * the first ten minutes.
 */
export class CreditLedger {
  private readonly usage = new Map<string, number>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  static isUnlimited(allowance: FreeAllowance | null): boolean {
    return allowance !== null && allowance.unit === 'unlimited';
  }

  /** Period identifier, e.g. "2026-11-08", "2026-W45", "2026-11", "once". */
  periodKey(period: Period, utcOffsetMinutes = 0): string {
    if (period === 'once') return 'once';
    const shifted = new Date(this.now().getTime() + utcOffsetMinutes * 60_000);
    const iso = shifted.toISOString();
    if (period === 'day') return iso.slice(0, 10);
    if (period === 'month') return iso.slice(0, 7);
    return isoWeek(shifted);
  }

  keyFor(site: SiteEntry, utcOffsetMinutes = 0): string {
    const period = site.free?.period ?? 'day';
    return `${site.id}:${this.periodKey(period, utcOffsetMinutes)}`;
  }

  used(site: SiteEntry, offset = 0): number {
    return this.usage.get(this.keyFor(site, offset)) ?? 0;
  }

  remaining(site: SiteEntry, offset = 0): number {
    if (site.free === null) return 0;
    if (CreditLedger.isUnlimited(site.free)) return Number.POSITIVE_INFINITY;
    return Math.max(0, site.free.amount - this.used(site, offset));
  }

  remainingRatio(site: SiteEntry, offset = 0): number {
    if (site.free === null) return 0;
    if (CreditLedger.isUnlimited(site.free)) return 1;
    return this.remaining(site, offset) / site.free.amount;
  }

  /** Consume `amount` only if the allowance can cover it (atomic check + write). */
  tryConsume(site: SiteEntry, amount = 1, offset = 0): boolean {
    if (amount <= 0) return true;
    if (site.free === null) return false;
    if (CreditLedger.isUnlimited(site.free)) {
      this.usage.set(this.keyFor(site, offset), this.used(site, offset) + amount);
      return true;
    }
    const key = this.keyFor(site, offset);
    const usedNow = this.usage.get(key) ?? 0;
    if (usedNow + amount > site.free.amount) return false;
    this.usage.set(key, usedNow + amount);
    return true;
  }

  /** Return credits after a failed generation (most providers do not charge). */
  refund(site: SiteEntry, amount = 1, offset = 0): void {
    if (amount <= 0) return;
    const key = this.keyFor(site, offset);
    this.usage.set(key, Math.max(0, (this.usage.get(key) ?? 0) - amount));
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.usage.entries());
  }
}

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((+d - +yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
