import { describe, expect, it, vi } from 'vitest'
import { createMaintenanceScheduler } from './maintenanceScheduler'

describe('maintenance scheduler', () => {
  it('evaluates every active membership and isolates failures', async () => {
    const evaluateThresholds = vi.fn((planId: string) => {
      if (planId === 'broken') throw new Error('database busy')
    })
    const scheduler = createMaintenanceScheduler({
      listActiveMembershipIds: () => ['healthy', 'broken', 'another'],
      evaluateThresholds,
    }, { intervalMs: 60_000 })
    const result = await scheduler.runOnce(new Date('2026-08-27T00:00:00.000Z'))
    scheduler.stop()
    expect(evaluateThresholds).toHaveBeenCalledTimes(3)
    expect(result).toEqual({
      evaluated: 2,
      failed: [{ planId: 'broken', message: 'database busy' }],
    })
  })

  it('stops future manual runs and rejects unsafe intervals', async () => {
    const evaluateThresholds = vi.fn()
    const scheduler = createMaintenanceScheduler({
      listActiveMembershipIds: () => ['plan'],
      evaluateThresholds,
    }, { intervalMs: 60_000 })
    scheduler.stop()
    expect(await scheduler.runOnce()).toEqual({ evaluated: 0, failed: [] })
    expect(evaluateThresholds).not.toHaveBeenCalled()
    expect(() => createMaintenanceScheduler({
      listActiveMembershipIds: () => [],
      evaluateThresholds,
    }, { intervalMs: 1 })).toThrow('at least 60000ms')
  })
})
