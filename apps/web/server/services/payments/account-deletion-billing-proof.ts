import { randomUUID } from 'node:crypto'

export const accountDeletionBillingProofTtlMs = 30_000

type BillingProof = Readonly<{
  userId: string
  expiresAt: number
  active: boolean
}>

const billingProofs = new Map<string, BillingProof>()

export function issueAccountDeletionBillingProof(userId: string, now = Date.now()): string {
  pruneExpiredProofs(now)
  const token = `account_delete_proof_${randomUUID()}`
  billingProofs.set(token, {
    userId,
    expiresAt: now + accountDeletionBillingProofTtlMs,
    active: false
  })
  return token
}

export function activateAccountDeletionBillingProof(userId: string, token: string): boolean {
  const now = Date.now()
  pruneExpiredProofs(now)
  const proof = billingProofs.get(token)
  if (!proof || proof.userId !== userId || proof.expiresAt <= now) return false
  billingProofs.set(token, { ...proof, active: true })
  return true
}

export function revokeAccountDeletionBillingProof(token: string): void {
  billingProofs.delete(token)
}

export function consumeAccountDeletionBillingProof(userId: string, token: string | null | undefined): boolean {
  const now = Date.now()
  pruneExpiredProofs(now)
  if (token) {
    const proof = billingProofs.get(token)
    billingProofs.delete(token)
    return Boolean(proof && proof.userId === userId && proof.expiresAt > now)
  }
  for (const [candidate, proof] of billingProofs) {
    if (proof.active && proof.userId === userId && proof.expiresAt > now) {
      billingProofs.delete(candidate)
      return true
    }
  }
  return false
}

function pruneExpiredProofs(now: number): void {
  for (const [token, proof] of billingProofs) {
    if (proof.expiresAt <= now) billingProofs.delete(token)
  }
}
