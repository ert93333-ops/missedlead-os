type ThresholdEvaluationStore = {
  listActiveMembershipIds(): string[]
  evaluateThresholds(planId: string, options?: { now?: string }): unknown
}

export type MaintenanceScheduler = {
  runOnce(now?: Date): Promise<{ evaluated: number; failed: { planId: string; message: string }[] }>
  stop(): void
}

export function createMaintenanceScheduler(
  store: ThresholdEvaluationStore,
  options: { intervalMs: number; runImmediately?: boolean },
): MaintenanceScheduler {
  if (!Number.isInteger(options.intervalMs) || options.intervalMs < 60_000) {
    throw new Error('Maintenance scheduler interval must be at least 60000ms')
  }
  let running = false
  let stopped = false

  const runOnce = async (now = new Date()) => {
    if (running || stopped) return { evaluated: 0, failed: [] }
    running = true
    const failed: { planId: string; message: string }[] = []
    let evaluated = 0
    try {
      for (const planId of store.listActiveMembershipIds()) {
        try {
          store.evaluateThresholds(planId, { now: now.toISOString() })
          evaluated += 1
        } catch (error) {
          failed.push({ planId, message: error instanceof Error ? error.message : 'unknown_error' })
        }
      }
      return { evaluated, failed }
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => { void runOnce() }, options.intervalMs)
  timer.unref()
  if (options.runImmediately) queueMicrotask(() => { void runOnce() })

  return {
    runOnce,
    stop() {
      stopped = true
      clearInterval(timer)
    },
  }
}
