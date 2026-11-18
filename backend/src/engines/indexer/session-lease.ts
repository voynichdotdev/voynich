// Leader election on a Postgres session advisory lock. The lock lives exactly as long as its
// connection, so a deployment that exits, crashes or is replaced releases it at once, with no
// expiry to wait out. It holds a connection of its own: taken through a pool, the lock would sit
// on whichever pooled connection ran the query. Use a direct database URL, not a
// transaction-mode pooler, which can't hold session locks.

import pg from 'pg'

export class SessionLease {
  private client: pg.Client | null = null
  private owned = false
  private stopped = false

  /** `onLost` runs when the connection holding the lock drops. */
  constructor(private readonly options: { connectionString: string; name: string; onLost?: () => void }) {}

  get held() {
    return this.owned
  }

  async acquire(): Promise<boolean> {
    if (this.stopped) return false
    if (this.owned) return true
    if (!this.client) {
      const client = new pg.Client({ connectionString: this.options.connectionString })
      client.on('error', () => {
        if (this.client !== client) return
        this.client = null
        const wasOwned = this.owned
        this.owned = false
        if (wasOwned) this.options.onLost?.()
        void client.end().catch(() => {})
      })
      await client.connect()
      this.client = client
    }
    const result = await this.client.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired', [this.options.name])
    this.owned = result.rows[0]?.acquired === true
    return this.owned
  }

  /** Ends the connection, which releases the lock. */
  async release(): Promise<void> {
    this.stopped = true
    this.owned = false
    const client = this.client
    this.client = null
    if (client) await client.end()
  }
}
