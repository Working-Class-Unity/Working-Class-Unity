export const billingReconciliationRateLimitMax = 5
export const billingReconciliationRateLimitWindowMs = 60_000

type RateWindow = {
  count: number
  resetAt: number
}

const windows = new Map<string, RateWindow>()

export function consumeBillingReconciliationRateLimit(
  userId: string,
  now = Date.now()
): Readonly<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  pruneExpiredWindows(now)
  const current = windows.get(userId)
  if (!current || current.resetAt <= now) {
    windows.set(userId, {
      count: 1,
      resetAt: now + billingReconciliationRateLimitWindowMs
    })
    return { allowed: true }
  }

  if (current.count >= billingReconciliationRateLimitMax) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000))
    }
  }

  current.count += 1
  return { allowed: true }
}

export function resetBillingReconciliationRateLimitForTests(): void {
  if (process.env.NODE_ENV === 'test') windows.clear()
}

function pruneExpiredWindows(now: number): void {
  for (const [userId, window] of windows) {
    if (window.resetAt <= now) windows.delete(userId)
  }
}
