/** In-memory sliding-window limiter, per key. Per process: on Vercel each function instance counts separately. */
export class RateLimiter {
  readonly #hits = new Map<string, number[]>()

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  /** Records a hit and returns whether it is within the limit. */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.#hits.get(key) ?? []).filter((time) => now - time < this.windowMs)
    if (recent.length >= this.limit) {
      this.#hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.#hits.set(key, recent)
    if (this.#hits.size > 10_000) this.#hits.clear()
    return true
  }
}

/**
 * A limit per browser (anonymous id) plus a looser ceiling per IP: a room on one Wi-Fi shares an IP, while a script
 * inventing new ids is still bounded. Requests without an id count as one browser per IP.
 */
export class VisitorLimiter {
  constructor(
    readonly perVisitor: RateLimiter,
    readonly perIp: RateLimiter,
  ) {}

  static of(perVisitor: number, perIp: number, windowMs = 60_000): VisitorLimiter {
    return new VisitorLimiter(new RateLimiter(perVisitor, windowMs), new RateLimiter(perIp, windowMs))
  }

  allow(client: Client, now = Date.now()): boolean {
    return this.perVisitor.allow(`${client.ip}|${client.visitor ?? '-'}`, now) && this.perIp.allow(client.ip, now)
  }
}

/** Who is asking, for rate limits: the client IP (real one behind Vercel/Render) and the browser's anonymous id. */
export type Client = { ip: string; visitor: string | null }
