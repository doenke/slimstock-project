/**
 * Slows down password guessing: after 5 failed logins for a user name from one address, that pair is
 * locked for 5 minutes, doubling with every further lock (max. 1 hour). A single address gets at most
 * 50 failures per 15 minutes across all names. In memory – one process is all the app runs.
 */
export class LoginLimiter {
  private pairs = new Map<string, { fails: number; locks: number; until: number }>();
  private addresses = new Map<string, { fails: number; since: number }>();

  constructor(private now: () => number = Date.now) {}

  /** Milliseconds until the next attempt is allowed, 0 if allowed now. */
  wait(username: string, ip: string): number {
    const t = this.now();
    const a = this.addresses.get(ip);
    if (a && t - a.since < 15 * 60_000 && a.fails >= 50) return a.since + 15 * 60_000 - t;
    const p = this.pairs.get(`${username}\u0000${ip}`);
    return p && p.until > t ? p.until - t : 0;
  }

  fail(username: string, ip: string): void {
    const t = this.now();
    const a = this.addresses.get(ip);
    if (!a || t - a.since >= 15 * 60_000) this.addresses.set(ip, { fails: 1, since: t });
    else a.fails++;
    const key = `${username}\u0000${ip}`;
    const p = this.pairs.get(key) ?? { fails: 0, locks: 0, until: 0 };
    p.fails++;
    if (p.fails >= 5) {
      p.until = t + Math.min(5 * 60_000 * 2 ** p.locks, 60 * 60_000);
      p.locks++;
      p.fails = 0;
    }
    this.pairs.set(key, p);
  }

  succeed(username: string, ip: string): void {
    this.pairs.delete(`${username}\u0000${ip}`);
  }
}
