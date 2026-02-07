import { describe, expect, it } from 'vitest'

import { mapDuesRecord, mapMemberProfileRecord } from '../../server/lib/membership/mappers'

describe('Membership mappers', () => {
  it('maps member profile records safely', () => {
    const mapped = mapMemberProfileRecord({
      id: 'profile_1',
      userId: 'user_1',
      fullName: 'Alex Worker',
      committee: 'membership',
      isInGoodStanding: true,
      duesPaidThrough: '2026-03-01T00:00:00.000Z',
      joinedAt: '2025-01-01T00:00:00.000Z',
    })

    expect(mapped.id).toBe('profile_1')
    expect(mapped.userId).toBe('user_1')
    expect(mapped.fullName).toBe('Alex Worker')
    expect(mapped.committee).toBe('membership')
    expect(mapped.isInGoodStanding).toBe(true)
  })

  it('maps dues records with normalized defaults', () => {
    const mapped = mapDuesRecord({
      id: 'dues_1',
      memberId: 'member_1',
      amountCents: '2700',
      currency: 'USD',
      paidAt: '2026-01-10T00:00:00.000Z',
      source: 'manual',
      stripeInvoiceId: null,
    })

    expect(mapped.id).toBe('dues_1')
    expect(mapped.memberId).toBe('member_1')
    expect(mapped.amountCents).toBe(2700)
    expect(mapped.source).toBe('manual')
    expect(mapped.currency).toBe('USD')
  })
})
