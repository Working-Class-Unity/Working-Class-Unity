import type { RecordModel } from 'pocketbase'

import type { OutreachInteraction } from '~~/shared/types/tenant-ops'

const ACTIVE_BUILDING_STATUSES = new Set(['target', 'active'])

const normalizeString = (value: unknown): string => {
  return typeof value === 'string' ? value : ''
}

export function countActiveBuildings(records: RecordModel[]): number {
  return records.filter((record) => {
    const status = normalizeString(record.status)
    return ACTIVE_BUILDING_STATUSES.has(status)
  }).length
}

export function countInteractionsInWindow(
  records: RecordModel[],
  dateField: string,
  days: number,
  now = new Date()
): number {
  const start = new Date(now)
  start.setDate(start.getDate() - days)

  return records.filter((record) => {
    const occurredAtValue = normalizeString(record[dateField] ?? record.occurredAt)
    if (!occurredAtValue) return false

    const occurredAt = new Date(occurredAtValue)
    if (Number.isNaN(occurredAt.getTime())) return false

    return occurredAt >= start && occurredAt <= now
  }).length
}

const normalizeInteractionType = (value: unknown): OutreachInteraction['interactionType'] => {
  if (value === 'phone' || value === 'meeting' || value === 'follow-up') {
    return value
  }

  return 'door-knock'
}

export function mapOutreachInteraction(
  record: RecordModel,
  dateField: string,
  buildingField: string
): OutreachInteraction {
  return {
    id: record.id,
    buildingId: normalizeString(record[buildingField] ?? record.buildingId),
    organizerUserId: normalizeString(record.organizerUserId ?? record.organizer ?? record.userId ?? record.user),
    occurredAt: normalizeString(record[dateField] ?? record.occurredAt ?? record.created),
    interactionType: normalizeInteractionType(record.interactionType ?? record.type),
    notes: normalizeString(record.notes),
  }
}
