import type { RecordModel } from 'pocketbase'

import type { DuesRecord, MemberProfile } from '~~/shared/types/membership'

type Committee = MemberProfile['committee']

const normalizeCommittee = (value: unknown): Committee => {
  if (value === 'membership' || value === 'education' || value === 'treasurer') {
    return value
  }

  return null
}

const normalizeBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'false') return false
  }

  return false
}

const normalizeNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value)
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return Math.round(parsed)
    }
  }

  return 0
}

const normalizeString = (value: unknown): string => {
  return typeof value === 'string' ? value : ''
}

const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }

  return null
}

const normalizeSource = (value: unknown): DuesRecord['source'] => {
  if (value === 'manual') {
    return 'manual'
  }

  return 'stripe'
}

export function mapMemberProfileRecord(record: RecordModel): MemberProfile {
  return {
    id: record.id,
    userId: normalizeString(record.userId ?? record.user),
    fullName: normalizeString(record.fullName ?? record.name),
    committee: normalizeCommittee(record.committee),
    isInGoodStanding: normalizeBoolean(record.isInGoodStanding ?? record.is_in_good_standing),
    duesPaidThrough: normalizeOptionalString(record.duesPaidThrough ?? record.dues_paid_through),
    joinedAt: normalizeString(record.joinedAt ?? record.created),
  }
}

export function mapDuesRecord(record: RecordModel): DuesRecord {
  return {
    id: record.id,
    memberId: normalizeString(record.memberId ?? record.member ?? record.userId ?? record.user),
    amountCents: normalizeNumber(record.amountCents ?? record.amount_cents ?? record.amount),
    currency: normalizeString(record.currency) || 'USD',
    paidAt: normalizeString(record.paidAt ?? record.paid_at ?? record.created),
    source: normalizeSource(record.source),
    stripeInvoiceId: normalizeOptionalString(record.stripeInvoiceId ?? record.stripe_invoice_id),
  }
}
