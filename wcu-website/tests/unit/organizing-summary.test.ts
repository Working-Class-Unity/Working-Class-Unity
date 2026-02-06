import { describe, expect, it } from 'vitest'
import type { RecordModel } from 'pocketbase'

import { countActiveBuildings, countInteractionsInWindow } from '../../server/lib/organizing/summary'

describe('Organizing summary helpers', () => {
  it('counts active/target buildings', () => {
    const buildings: RecordModel[] = [
      { id: 'b1', status: 'active' },
      { id: 'b2', status: 'target' },
      { id: 'b3', status: 'won' },
    ] as RecordModel[]
    const count = countActiveBuildings(buildings)

    expect(count).toBe(2)
  })

  it('counts interactions in a 30-day window', () => {
    const records: RecordModel[] = [
      { id: 'i1', occurredAt: '2026-01-20T00:00:00.000Z' },
      { id: 'i2', occurredAt: '2025-12-01T00:00:00.000Z' },
      { id: 'i3', occurredAt: '2026-01-30T00:00:00.000Z' },
    ] as RecordModel[]

    const count = countInteractionsInWindow(records, 'occurredAt', 30, new Date('2026-02-01T00:00:00.000Z'))

    expect(count).toBe(2)
  })
})
