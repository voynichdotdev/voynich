// The tasks a keeper runs each tick, each on its own interval. A task that throws backs off on its
// own (default one minute) without stopping the others; per-item work spreads over its interval
// by a hash of the item, so a thousand coins don't all hit the RPC in the same second.

import { createHash } from 'node:crypto'

export type Task = {
  name: string
  /** minimum time between runs */
  everyMs: number
  run: (now: number) => Promise<unknown>
}

export type SchedulerOptions = {
  backoffMs?: number
  /** errors carry only the task name and a code-like message, never payloads */
  onError?: (task: string, error: unknown) => void
}

export function createScheduler(tasks: readonly Task[], options: SchedulerOptions = {}) {
  const { backoffMs = 60_000, onError } = options
  const lastRun = new Map<string, number>()
  const blockedUntil = new Map<string, number>()

  /** Runs `fn` unless `name` is backing off; a failure blocks it for `backoffMs`. */
  async function safely(name: string, fn: () => Promise<unknown>, now = Date.now()) {
    if ((blockedUntil.get(name) ?? 0) > now) return
    try {
      await fn()
      blockedUntil.delete(name)
    } catch (e) {
      blockedUntil.set(name, now + backoffMs)
      onError?.(name, e)
    }
  }

  /** Runs every task that is due. Independent tasks run one after another; fan out inside a task. */
  async function tick(now = Date.now()) {
    for (const task of tasks) {
      if (now - (lastRun.get(task.name) ?? -Infinity) < task.everyMs) continue
      lastRun.set(task.name, now)
      await safely(task.name, () => task.run(now), now)
    }
  }

  return { tick, safely }
}

/** A stable offset within `intervalMs` for one item, so per-item work spreads out. */
export function phase(key: string, intervalMs: number): number {
  return createHash('sha256').update(key).digest().readUInt32LE(0) % intervalMs
}

/** Whether a per-item job is due this tick: every `intervalMs`, offset by the item's phase. */
export function dueForItem(key: string, intervalMs: number, now: number, tickMs: number): boolean {
  const offset = (now - phase(key, intervalMs)) % intervalMs
  return offset >= 0 && offset < tickMs
}
