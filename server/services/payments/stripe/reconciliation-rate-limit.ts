export const billingReconciliationRateLimitMax = 5
export const billingReconciliationRateLimitWindowMs = 60_000

type RateWindow = { count: number; resetAt: number }
const windows = new Map<string, RateWindow>()

export function consumeBillingReconciliationRateLimit(
  purchaserUserId: string,
  now = Date.now()
): Readonly<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  for (const [key, window] of windows) if (window.resetAt <= now) windows.delete(key)
  const current = windows.get(purchaserUserId)
  if (!current || current.resetAt <= now) {
    windows.set(purchaserUserId, { count: 1, resetAt: now + billingReconciliationRateLimitWindowMs })
    return { allowed: true }
  }
  if (current.count >= billingReconciliationRateLimitMax) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)) }
  }
  current.count += 1
  return { allowed: true }
}

export function resetBillingReconciliationRateLimitForTests(): void {
  if (process.env.NODE_ENV === 'test') windows.clear()
}
