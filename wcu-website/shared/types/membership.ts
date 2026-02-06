export interface MemberProfile {
  id: string
  userId: string
  fullName: string
  committee: 'membership' | 'education' | 'treasurer' | null
  isInGoodStanding: boolean
  duesPaidThrough: string | null
  joinedAt: string
}

export interface DuesRecord {
  id: string
  memberId: string
  amountCents: number
  currency: string
  paidAt: string
  source: 'stripe' | 'manual'
  stripeInvoiceId: string | null
}
