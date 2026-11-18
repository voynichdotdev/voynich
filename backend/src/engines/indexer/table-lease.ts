// Leader election on a worker_leases row, for hosts where a dedicated connection isn't wanted. The
// holder renews by acquiring again before the lease runs out; anyone takes it over once it has
// expired. Expiry is compared in database time (clock_timestamp), never against host clocks.

import { randomUUID } from 'node:crypto'

type Sql = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>
}

export class TableLease {
  readonly owner = randomUUID()
  private released = false

  /** `ttlSeconds` must comfortably exceed the interval acquire() is called on. */
  constructor(
    private readonly db: Sql,
    private readonly name: string,
    private readonly ttlSeconds = 30,
  ) {}

  /** Takes the lease if it is free or expired, renews it if held; true while this owner holds it. */
  async acquire(): Promise<boolean> {
    if (this.released) return false
    const rows = await this.db.$queryRaw<{ owner: string }[]>`
      INSERT INTO worker_leases (name, owner, expires_at)
      VALUES (${this.name}, ${this.owner}, clock_timestamp() + make_interval(secs => ${this.ttlSeconds}))
      ON CONFLICT (name) DO UPDATE SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
      WHERE worker_leases.expires_at < clock_timestamp() OR worker_leases.owner = EXCLUDED.owner
      RETURNING owner`
    return rows[0]?.owner === this.owner
  }

  async release(): Promise<void> {
    this.released = true
    await this.db.$executeRaw`DELETE FROM worker_leases WHERE name = ${this.name} AND owner = ${this.owner}`
  }
}
