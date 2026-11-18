// Fixture mode on the server: each request picks a scenario by header (or ?fixture=, since
// EventSource can't set headers), any error code as the scenario forces that error's envelope, and
// each browser tab can keep its own fixture state, so flows that change data (a launch that then
// appears in the feed) play out without one tab's clicks leaking into another's.

import type { Context, MiddlewareHandler } from 'hono'
import type { ApiErrorBody } from './contract/errors.js'
import { ApiFailure, fail } from './errors.js'

export type FixtureVariables<S extends string> = { scenario: S | null }

export type ScenarioOptions<S extends string> = {
  scenarios: readonly S[]
  /** the forced-error envelope per code (contract fixtureErrors) and the code's status */
  errors: Record<string, ApiErrorBody>
  status: Record<string, number>
  header?: string
}

export function fixtureScenario<S extends string>(options: ScenarioOptions<S>): MiddlewareHandler<{ Variables: FixtureVariables<S> }> {
  const header = options.header ?? 'X-Fixture'
  return async (c, next) => {
    const value = c.req.header(header) ?? c.req.query('fixture')
    if (value && Object.hasOwn(options.errors, value)) {
      const body = options.errors[value]!
      throw new ApiFailure(options.status[value] ?? 500, body)
    }
    if (value && !options.scenarios.includes(value as S)) {
      fail('VALIDATION_ERROR', `Unknown fixture scenario: ${value}.`, { stage: 'validation' })
    }
    c.set('scenario', (value as S | undefined) ?? null)
    await next()
  }
}

/** Fixture state per tab: the web sends a random id it keeps in sessionStorage as X-Fixture-Session. */
export class FixtureSessions<State> {
  private sessions = new Map<string, State>()
  constructor(
    private readonly create: (scenario: string | null) => State,
    private readonly options: { header?: string; max?: number } = {},
  ) {}

  get(c: Context, scenario: string | null): State {
    const id = c.req.header(this.options.header ?? 'X-Fixture-Session') ?? c.req.query('session') ?? 'default'
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) fail('VALIDATION_ERROR', 'The session id is invalid.', { stage: 'validation' })
    const key = `${scenario ?? 'default'}:${id}`
    let state = this.sessions.get(key)
    if (state) {
      // Map order is insertion order: re-insert so the least recently used session is first.
      this.sessions.delete(key)
    } else {
      if (this.sessions.size >= (this.options.max ?? 200)) this.sessions.delete(this.sessions.keys().next().value!)
      state = this.create(scenario)
    }
    this.sessions.set(key, state)
    return state
  }

  clear() {
    this.sessions.clear()
  }
}
