import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { user } from './auth'
import { createdAtColumn, updatedAtColumn } from './core'
import { externalRecordSnapshots } from './provenance'

export const contactKinds = ['email', 'phone'] as const
export const preferredContactMethods = ['email', 'text'] as const
export const identityProviders = ['stripe', 'solidarity', 'discourse', 'pocketbase'] as const
export const providerIdentityStates = ['unlinked', 'active', 'inactive'] as const

export const people = sqliteTable(
  'people',
  {
    id: text('id').primaryKey(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    displayName: text('display_name'),
    preferredContactMethod: text('preferred_contact_method', { enum: preferredContactMethods }),
    whatsappEnabled: integer('whatsapp_enabled', { mode: 'boolean' }).notNull().default(false),
    archivedAt: text('archived_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('people_name_idx').on(table.lastName, table.firstName),
    check(
      'people_first_name_check',
      sql`${table.firstName} is null or (${table.firstName} = trim(${table.firstName}) and length(${table.firstName}) between 1 and 100)`
    ),
    check(
      'people_last_name_check',
      sql`${table.lastName} is null or (${table.lastName} = trim(${table.lastName}) and length(${table.lastName}) between 1 and 100)`
    ),
    check(
      'people_display_name_check',
      sql`${table.displayName} is null or (${table.displayName} = trim(${table.displayName}) and length(${table.displayName}) between 1 and 100)`
    ),
    check(
      'people_preferred_contact_check',
      sql`${table.preferredContactMethod} is null or ${table.preferredContactMethod} in ('email', 'text')`
    ),
    check('people_archived_at_check', sql`${table.archivedAt} is null or julianday(${table.archivedAt}) is not null`)
  ]
)

export const personContacts = sqliteTable(
  'person_contacts',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: contactKinds }).notNull(),
    value: text('value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    verifiedAt: text('verified_at'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('person_contacts_person_kind_value_uidx').on(table.personId, table.kind, table.normalizedValue),
    uniqueIndex('person_contacts_one_primary_uidx')
      .on(table.personId, table.kind)
      .where(sql`${table.isPrimary} = 1`),
    index('person_contacts_normalized_idx').on(table.kind, table.normalizedValue),
    check('person_contacts_kind_check', sql`${table.kind} in ('email', 'phone')`),
    check(
      'person_contacts_value_check',
      sql`length(trim(${table.value})) between 1 and 320 and length(trim(${table.normalizedValue})) between 1 and 320`
    ),
    check(
      'person_contacts_verified_at_check',
      sql`${table.verifiedAt} is null or julianday(${table.verifiedAt}) is not null`
    )
  ]
)

export const personAccounts = sqliteTable(
  'person_accounts',
  {
    personId: text('person_id')
      .primaryKey()
      .references(() => people.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    linkedAt: text('linked_at').notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex('person_accounts_user_id_uidx').on(table.userId),
    check('person_accounts_linked_at_check', sql`julianday(${table.linkedAt}) is not null`)
  ]
)

export const providerIdentities = sqliteTable(
  'provider_identities',
  {
    id: text('id').primaryKey(),
    personId: text('person_id').references(() => people.id, { onDelete: 'restrict' }),
    provider: text('provider', { enum: identityProviders }).notNull(),
    externalId: text('external_id').notNull(),
    lookupKey: text('lookup_key'),
    state: text('state', { enum: providerIdentityStates }).notNull().default('unlinked'),
    linkedAt: text('linked_at'),
    lastSyncedAt: text('last_synced_at'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('provider_identities_provider_external_uidx').on(table.provider, table.externalId),
    uniqueIndex('provider_identities_provider_lookup_uidx')
      .on(table.provider, table.lookupKey)
      .where(sql`${table.lookupKey} is not null`),
    index('provider_identities_person_idx').on(table.personId, table.provider),
    check(
      'provider_identities_provider_check',
      sql`${table.provider} in ('stripe', 'solidarity', 'discourse', 'pocketbase')`
    ),
    check('provider_identities_state_check', sql`${table.state} in ('unlinked', 'active', 'inactive')`),
    check(
      'provider_identities_link_check',
      sql`(${table.state} = 'unlinked' and ${table.personId} is null and ${table.linkedAt} is null) or (${table.state} in ('active', 'inactive') and ${table.personId} is not null and ${table.linkedAt} is not null and julianday(${table.linkedAt}) is not null)`
    ),
    check(
      'provider_identities_external_check',
      sql`length(trim(${table.externalId})) between 1 and 255 and (${table.lookupKey} is null or length(trim(${table.lookupKey})) between 1 and 255)`
    ),
    check(
      'provider_identities_synced_at_check',
      sql`${table.lastSyncedAt} is null or julianday(${table.lastSyncedAt}) is not null`
    )
  ]
)

export type ContactKind = (typeof contactKinds)[number]
export type PreferredContactMethod = (typeof preferredContactMethods)[number]
export type IdentityProvider = (typeof identityProviders)[number]
export type ProviderIdentityState = (typeof providerIdentityStates)[number]
export type Person = typeof people.$inferSelect
export type PersonContact = typeof personContacts.$inferSelect
export type ProviderIdentity = typeof providerIdentities.$inferSelect
