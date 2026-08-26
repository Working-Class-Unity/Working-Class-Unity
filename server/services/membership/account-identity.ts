import { createHmac, randomUUID } from 'node:crypto'
import type { IdentityReviewReason } from '../../db/schema/identity'
import type { BillingStripeConnection } from '../payments/stripe/public-contract'
import { isTemporaryPhoneEmail, normalizeUsPhoneNumber } from '../../utils/auth/phone'
import { adoptImportedStripeBilling, type ImportedStripeBillingPrices } from './imported-stripe-billing'

export type WebsiteAccountIdentity = Readonly<{
  id: string
  email: string
  emailVerified: boolean
  phoneNumber?: string | null
  phoneNumberVerified?: boolean
}>

export type WebsiteAccountIdentityResult = Readonly<{
  personId: string | null
  reviewCreated: boolean
  reviewReason: IdentityReviewReason | null
}>

export type WebsiteAccountIdentityOptions = Readonly<{
  observedAt?: Date
  reviewHashKey: string
  stripePrices?: ImportedStripeBillingPrices
}>

type PhoneOnlyCollapseResult =
  | Readonly<{
      adoption: ReturnType<typeof adoptImportedStripeBilling> | null
      outcome: 'collapsed'
      personId: string
    }>
  | Readonly<{
      identifier: string
      outcome: 'adoption_conflict'
    }>

export function ensureWebsiteAccountIdentity(
  connection: BillingStripeConnection,
  account: WebsiteAccountIdentity,
  options: WebsiteAccountIdentityOptions
): WebsiteAccountIdentityResult {
  return connection.sqlite
    .transaction(() => ensureWebsiteAccountIdentityInTransaction(connection, account, options))
    .immediate()
}

export function ensureWebsiteAccountIdentityInTransaction(
  connection: BillingStripeConnection,
  account: WebsiteAccountIdentity,
  options: WebsiteAccountIdentityOptions
): WebsiteAccountIdentityResult {
  const observedAt = options.observedAt ?? new Date()
  const timestamp = observedAt.toISOString()
  const email = account.emailVerified && !isTemporaryPhoneEmail(account.email) ? normalizeEmail(account.email) : null
  const phone = account.phoneNumberVerified ? normalizeUsPhoneNumber(account.phoneNumber ?? '') : null

  let linked = personForUser(connection, account.id)
  if (linked) {
    const collapse = collapseUnreferencedPhoneOnlyPerson(
      connection,
      account.id,
      linked,
      email,
      phone,
      timestamp,
      observedAt,
      options.stripePrices
    )
    if (collapse?.outcome === 'adoption_conflict') {
      return recordReview(
        connection,
        account.id,
        'conflicting_verified_identifiers',
        collapse.identifier,
        options.reviewHashKey,
        timestamp,
        linked
      )
    }
    if (collapse?.outcome === 'collapsed') linked = collapse.personId
    for (const conflict of contactConflicts(connection, linked, email, phone)) {
      if (resolvedReviewAllows(connection, account.id, linked, conflict.value, options.reviewHashKey)) {
        continue
      }
      return recordReview(
        connection,
        account.id,
        conflict.reason,
        conflict.value,
        options.reviewHashKey,
        timestamp,
        linked
      )
    }
    if (
      email &&
      otherVerifiedUsersForEmail(connection, account.id, email).length &&
      !resolvedReviewAllows(connection, account.id, linked, email, options.reviewHashKey)
    ) {
      return recordReview(
        connection,
        account.id,
        'conflicting_verified_email',
        email,
        options.reviewHashKey,
        timestamp,
        linked
      )
    }
    synchronizeContact(connection, linked, 'email', email, timestamp)
    synchronizeContact(connection, linked, 'phone', phone, timestamp)
    const adoption =
      collapse?.outcome === 'collapsed'
        ? collapse.adoption
        : options.stripePrices
          ? adoptImportedStripeBilling(connection, account.id, options.stripePrices, observedAt)
          : null
    if (adoption?.outcome === 'conflict') {
      return recordReview(
        connection,
        account.id,
        'conflicting_verified_identifiers',
        adoption.identifier!,
        options.reviewHashKey,
        timestamp,
        linked
      )
    }
    return result(linked)
  }

  const emailPeople = email ? peopleForClaimableEmail(connection, email) : []
  const phonePeople = phone ? peopleForVerifiedContact(connection, 'phone', phone) : []
  if (emailPeople.length > 1) {
    return recordReview(connection, account.id, 'ambiguous_verified_email', email!, options.reviewHashKey, timestamp)
  }
  if (email && otherVerifiedUsersForEmail(connection, account.id, email).length) {
    return recordReview(connection, account.id, 'conflicting_verified_email', email, options.reviewHashKey, timestamp)
  }
  if (emailPeople.length === 0 && phonePeople.length > 0) {
    return recordReview(
      connection,
      account.id,
      'phone_match_requires_verified_email',
      phone!,
      options.reviewHashKey,
      timestamp
    )
  }
  const emailPerson = emailPeople[0] ?? null
  if (emailPerson && phonePeople.some((personId) => personId !== emailPerson)) {
    return recordReview(
      connection,
      account.id,
      'conflicting_verified_identifiers',
      phone!,
      options.reviewHashKey,
      timestamp
    )
  }
  if (emailPerson && userForPerson(connection, emailPerson)) {
    return recordReview(connection, account.id, 'conflicting_verified_email', email!, options.reviewHashKey, timestamp)
  }

  const personId = emailPerson ?? `person_account_${randomUUID()}`
  if (!emailPerson) {
    connection.sqlite
      .prepare('insert into people (id, created_at, updated_at) values (?, ?, ?)')
      .run(personId, timestamp, timestamp)
  }
  connection.sqlite
    .prepare('insert into person_accounts (person_id, user_id, linked_at, created_at) values (?, ?, ?, ?)')
    .run(personId, account.id, timestamp, timestamp)
  synchronizeContact(connection, personId, 'email', email, timestamp)
  synchronizeContact(connection, personId, 'phone', phone, timestamp)
  const adoption = options.stripePrices
    ? adoptImportedStripeBilling(connection, account.id, options.stripePrices, observedAt)
    : null
  if (adoption?.outcome === 'conflict') {
    return recordReview(
      connection,
      account.id,
      'conflicting_verified_identifiers',
      adoption.identifier!,
      options.reviewHashKey,
      timestamp,
      personId
    )
  }
  return result(personId)
}

export function recordWebsiteAccountIdentityReviewInTransaction(
  connection: BillingStripeConnection,
  input: Readonly<{
    identifier: string
    observedAt: Date
    reason: IdentityReviewReason
    reviewHashKey: string
    userId: string
  }>
): WebsiteAccountIdentityResult {
  return recordReview(
    connection,
    input.userId,
    input.reason,
    input.identifier,
    input.reviewHashKey,
    input.observedAt.toISOString(),
    personForUser(connection, input.userId)
  )
}

export function hasOpenWebsiteAccountIdentityReview(connection: BillingStripeConnection, userId: string): boolean {
  return Boolean(
    connection.sqlite
      .prepare("select 1 from identity_link_reviews where user_id = ? and status = 'open' limit 1")
      .get(userId)
  )
}

function collapseUnreferencedPhoneOnlyPerson(
  connection: BillingStripeConnection,
  userId: string,
  sourcePersonId: string,
  email: string | null,
  phone: string | null,
  timestamp: string,
  observedAt: Date,
  stripePrices: ImportedStripeBillingPrices | undefined
): PhoneOnlyCollapseResult | null {
  if (!email || !phone || !sourcePersonId.startsWith('person_account_')) return null
  const targets = peopleForClaimableEmail(connection, email).filter((personId) => personId !== sourcePersonId)
  if (targets.length !== 1) return null
  const targetPersonId = targets[0]!
  if (
    userForPerson(connection, targetPersonId) ||
    otherVerifiedUsersForEmail(connection, userId, email).length > 0 ||
    peopleForVerifiedContact(connection, 'phone', phone).some(
      (personId) => personId !== sourcePersonId && personId !== targetPersonId
    )
  )
    return null

  const source = connection.sqlite
    .prepare(
      `select id from people
       where id = ? and first_name is null and last_name is null and display_name is null
         and preferred_contact_method is null and whatsapp_enabled = 0 and archived_at is null
         and not exists (select 1 from provider_identities where person_id = ?)`
    )
    .get(sourcePersonId, sourcePersonId)
  const contacts = connection.sqlite
    .prepare(
      `select kind, normalized_value as normalizedValue, is_primary as isPrimary,
              verified_at as verifiedAt, source_snapshot_id as sourceSnapshotId
       from person_contacts where person_id = ? order by id`
    )
    .all(sourcePersonId) as Array<{
    isPrimary: number
    kind: string
    normalizedValue: string
    sourceSnapshotId: string | null
    verifiedAt: string | null
  }>
  if (
    !source ||
    contacts.length !== 1 ||
    contacts[0]?.kind !== 'phone' ||
    contacts[0].normalizedValue !== phone ||
    contacts[0].isPrimary !== 1 ||
    !contacts[0].verifiedAt ||
    contacts[0].sourceSnapshotId
  )
    return null

  connection.sqlite.exec('savepoint collapse_phone_only_account_person')
  try {
    connection.sqlite.prepare('delete from person_contacts where person_id = ?').run(sourcePersonId)
    const relinked = connection.sqlite
      .prepare('update person_accounts set person_id = ? where person_id = ? and user_id = ?')
      .run(targetPersonId, sourcePersonId, userId)
    if (relinked.changes !== 1) throw new Error('Phone-only account person changed')
    synchronizeContact(connection, targetPersonId, 'phone', phone, timestamp)
    const removed = connection.sqlite.prepare('delete from people where id = ?').run(sourcePersonId)
    if (removed.changes !== 1) throw new Error('Phone-only account person changed')
    const adoption = stripePrices ? adoptImportedStripeBilling(connection, userId, stripePrices, observedAt) : null
    if (adoption?.outcome === 'conflict') {
      connection.sqlite.exec(
        'rollback to collapse_phone_only_account_person; release collapse_phone_only_account_person'
      )
      return Object.freeze({
        identifier: adoption.identifier!,
        outcome: 'adoption_conflict' as const
      })
    }
    connection.sqlite.exec('release collapse_phone_only_account_person')
    return Object.freeze({ adoption, outcome: 'collapsed' as const, personId: targetPersonId })
  } catch {
    connection.sqlite.exec('rollback to collapse_phone_only_account_person; release collapse_phone_only_account_person')
    return null
  }
}

function contactConflicts(
  connection: BillingStripeConnection,
  personId: string,
  email: string | null,
  phone: string | null
): Array<Readonly<{ reason: IdentityReviewReason; value: string }>> {
  const conflicts: Array<Readonly<{ reason: IdentityReviewReason; value: string }>> = []
  if (email) {
    const owners = peopleForClaimableEmail(connection, email).filter((value) => value !== personId)
    if (owners.length) conflicts.push({ reason: 'conflicting_verified_email', value: email })
  }
  if (phone) {
    const owners = peopleForVerifiedContact(connection, 'phone', phone).filter((value) => value !== personId)
    if (owners.length) conflicts.push({ reason: 'conflicting_verified_identifiers', value: phone })
  }
  return conflicts
}

function recordReview(
  connection: BillingStripeConnection,
  userId: string,
  reason: IdentityReviewReason,
  identifier: string,
  reviewHashKey: string,
  timestamp: string,
  existingPersonId: string | null = null
): WebsiteAccountIdentityResult {
  const reviewId = `identity_review_${randomUUID()}`
  const inserted = connection.sqlite
    .prepare(
      `insert into identity_link_reviews
         (id, user_id, reason, identifier_hash, status, created_at, updated_at)
       values (?, ?, ?, ?, 'open', ?, ?)
       on conflict do nothing`
    )
    .run(reviewId, userId, reason, hmacSha256(identifier, reviewHashKey), timestamp, timestamp)
  if (inserted.changes === 1) {
    connection.sqlite
      .prepare('insert into job_queue (type, payload, created_at, updated_at) values (?, ?, ?, ?)')
      .run('identity.review-notification', JSON.stringify({ reviewId }), timestamp, timestamp)
  }
  return Object.freeze({
    personId: existingPersonId,
    reviewCreated: inserted.changes === 1,
    reviewReason: reason
  })
}

function synchronizeContact(
  connection: BillingStripeConnection,
  personId: string,
  kind: 'email' | 'phone',
  normalizedValue: string | null,
  timestamp: string
): void {
  if (!normalizedValue) return
  connection.sqlite
    .prepare(
      `update person_contacts set is_primary = 0, updated_at = ?
       where person_id = ? and kind = ? and normalized_value <> ? and is_primary = 1`
    )
    .run(timestamp, personId, kind, normalizedValue)
  connection.sqlite
    .prepare(
      `insert into person_contacts
         (id, person_id, kind, value, normalized_value, is_primary, verified_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, 1, ?, ?, ?)
       on conflict(person_id, kind, normalized_value) do update set
         is_primary = 1,
         verified_at = coalesce(person_contacts.verified_at, excluded.verified_at),
         updated_at = excluded.updated_at`
    )
    .run(
      `person_contact_${randomUUID()}`,
      personId,
      kind,
      normalizedValue,
      normalizedValue,
      timestamp,
      timestamp,
      timestamp
    )
}

function peopleForVerifiedContact(
  connection: BillingStripeConnection,
  kind: 'email' | 'phone',
  normalizedValue: string
): string[] {
  return (
    connection.sqlite
      .prepare(
        `select distinct person_id as personId from person_contacts
         where kind = ? and normalized_value = ? and verified_at is not null
         order by person_id`
      )
      .all(kind, normalizedValue) as Array<{ personId: string }>
  ).map(({ personId }) => personId)
}

function peopleForClaimableEmail(connection: BillingStripeConnection, normalizedValue: string): string[] {
  return (
    connection.sqlite
      .prepare(
        `select distinct pc.person_id as personId
         from person_contacts pc
         where pc.kind = 'email' and pc.normalized_value = ?
           and (
             pc.verified_at is not null
             or exists (
               select 1 from provider_identities pi
               where pi.person_id = pc.person_id and pi.provider = 'stripe' and pi.state = 'active'
             )
           )
         order by pc.person_id`
      )
      .all(normalizedValue) as Array<{ personId: string }>
  ).map(({ personId }) => personId)
}

function otherVerifiedUsersForEmail(
  connection: BillingStripeConnection,
  userId: string,
  normalizedEmail: string
): string[] {
  return (
    connection.sqlite
      .prepare(
        `select id from user
         where id <> ? and email_verified = 1 and lower(trim(email)) = ?
         order by id`
      )
      .all(userId, normalizedEmail) as Array<{ id: string }>
  ).map(({ id }) => id)
}

function personForUser(connection: BillingStripeConnection, userId: string): string | null {
  const row = connection.sqlite
    .prepare('select person_id as personId from person_accounts where user_id = ?')
    .get(userId) as { personId: string } | undefined
  return row?.personId ?? null
}

function userForPerson(connection: BillingStripeConnection, personId: string): string | null {
  const row = connection.sqlite
    .prepare('select user_id as userId from person_accounts where person_id = ?')
    .get(personId) as { userId: string } | undefined
  return row?.userId ?? null
}

function resolvedReviewAllows(
  connection: BillingStripeConnection,
  userId: string,
  personId: string,
  identifier: string,
  reviewHashKey: string
): boolean {
  return Boolean(
    connection.sqlite
      .prepare(
        `select 1 from identity_link_reviews
         where user_id = ? and status = 'resolved' and resolved_person_id = ? and identifier_hash = ?
         limit 1`
      )
      .get(userId, personId, hmacSha256(identifier, reviewHashKey))
  )
}

function normalizeEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  return normalized || null
}

function hmacSha256(value: string, key: string): string {
  return createHmac('sha256', key).update(value).digest('hex')
}

function result(personId: string): WebsiteAccountIdentityResult {
  return Object.freeze({ personId, reviewCreated: false, reviewReason: null })
}
