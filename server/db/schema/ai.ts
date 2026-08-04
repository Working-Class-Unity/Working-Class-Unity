import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { user } from './auth'
import { createdAtColumn, updatedAtColumn } from './core'

export const aiMessageRoles = ['user', 'assistant'] as const
export const aiGenerationAttemptStatuses = [
  'pending',
  'succeeded',
  'failed',
  'indeterminate',
  'refused',
  'cancelled'
] as const

export const aiConversations = sqliteTable(
  'ai_conversations',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    historyRevision: integer('history_revision').notNull().default(0),
    nextSequence: integer('next_sequence').notNull().default(1),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('ai_conversations_owner_updated_id_idx').on(table.ownerUserId, table.updatedAt, table.id),
    check(
      'ai_conversations_identity_check',
      sql`length(${table.id}) = 52 and substr(${table.id}, 1, 16) = 'ai_conversation_' and length(trim(${table.ownerUserId})) > 0`
    ),
    check('ai_conversations_sequence_check', sql`${table.historyRevision} >= 0 and ${table.nextSequence} >= 1`),
    check(
      'ai_conversations_timestamps_check',
      sql`julianday(${table.createdAt}) is not null and julianday(${table.updatedAt}) is not null and julianday(${table.updatedAt}) >= julianday(${table.createdAt})`
    )
  ]
)

export const aiMessages = sqliteTable(
  'ai_messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    role: text('role', { enum: aiMessageRoles }).notNull(),
    content: text('content').notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex('ai_messages_conversation_sequence_uidx').on(table.conversationId, table.sequence),
    index('ai_messages_conversation_created_id_idx').on(table.conversationId, table.createdAt, table.id),
    check(
      'ai_messages_identity_check',
      sql`length(${table.id}) = 47 and substr(${table.id}, 1, 11) = 'ai_message_' and length(trim(${table.conversationId})) > 0`
    ),
    check('ai_messages_sequence_check', sql`${table.sequence} >= 1`),
    check('ai_messages_role_check', sql`${table.role} in ('user', 'assistant')`),
    check('ai_messages_content_check', sql`length(${table.content}) between 1 and 1000000`),
    check('ai_messages_timestamp_check', sql`julianday(${table.createdAt}) is not null`)
  ]
)

export const aiMessageFileCitations = sqliteTable(
  'ai_message_file_citations',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => aiMessages.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    title: text('title').notNull()
  },
  (table) => [
    primaryKey({
      columns: [table.messageId, table.ordinal],
      name: 'ai_message_file_citations_message_ordinal_pk'
    }),
    uniqueIndex('ai_message_file_citations_message_title_uidx').on(table.messageId, table.title),
    check('ai_message_file_citations_ordinal_check', sql`${table.ordinal} between 1 and 10`),
    check(
      'ai_message_file_citations_title_check',
      sql`length(${table.title}) between 1 and 512 and ${table.title} = trim(${table.title}) and instr(${table.title}, char(0)) = 0 and ${table.title} not glob ('*[' || char(1) || '-' || char(31) || char(127) || ']*')`
    )
  ]
)

export const aiMessageWebCitations = sqliteTable(
  'ai_message_web_citations',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => aiMessages.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    startIndex: integer('start_index').notNull(),
    endIndex: integer('end_index').notNull()
  },
  (table) => [
    primaryKey({
      columns: [table.messageId, table.ordinal],
      name: 'ai_message_web_citations_message_ordinal_pk'
    }),
    uniqueIndex('ai_message_web_citations_message_url_span_uidx').on(
      table.messageId,
      table.url,
      table.startIndex,
      table.endIndex
    ),
    check('ai_message_web_citations_ordinal_check', sql`${table.ordinal} between 1 and 20`),
    check(
      'ai_message_web_citations_title_check',
      sql`length(${table.title}) between 1 and 512 and ${table.title} = trim(${table.title}) and instr(${table.title}, char(0)) = 0 and ${table.title} not glob ('*[' || char(1) || '-' || char(31) || char(127) || ']*')`
    ),
    check(
      'ai_message_web_citations_url_check',
      sql`length(${table.url}) between 1 and 4096 and ${table.url} = trim(${table.url}) and substr(${table.url}, 1, 8) = 'https://' and instr(${table.url}, char(0)) = 0 and ${table.url} not glob ('*[' || char(1) || '-' || char(31) || char(127) || ']*')`
    ),
    check(
      'ai_message_web_citations_span_check',
      sql`${table.startIndex} >= 0 and ${table.startIndex} < ${table.endIndex} and ${table.endIndex} <= 1000000`
    )
  ]
)

export const aiGenerationAttempts = sqliteTable(
  'ai_generation_attempts',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    userMessageId: text('user_message_id')
      .notNull()
      .references(() => aiMessages.id, { onDelete: 'cascade' }),
    assistantMessageId: text('assistant_message_id').references(() => aiMessages.id, { onDelete: 'cascade' }),
    clientRequestId: text('client_request_id').notNull(),
    historyRevision: integer('history_revision').notNull(),
    usageBucketDate: text('usage_bucket_date').notNull(),
    status: text('status', { enum: aiGenerationAttemptStatuses }).notNull().default('pending'),
    model: text('model').notNull(),
    providerRequestId: text('provider_request_id'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    cachedInputTokens: integer('cached_input_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    errorCode: text('error_code'),
    leaseExpiresAt: text('lease_expires_at'),
    completedAt: text('completed_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('ai_generation_attempts_conversation_client_request_uidx').on(
      table.conversationId,
      table.clientRequestId
    ),
    index('ai_generation_attempts_conversation_status_idx').on(table.conversationId, table.status),
    index('ai_generation_attempts_status_lease_idx').on(table.status, table.leaseExpiresAt),
    check(
      'ai_generation_attempts_identity_check',
      sql`length(${table.id}) = 47 and substr(${table.id}, 1, 11) = 'ai_attempt_' and length(trim(${table.conversationId})) > 0 and length(trim(${table.userMessageId})) > 0`
    ),
    check(
      'ai_generation_attempts_request_check',
      sql`length(trim(${table.clientRequestId})) between 1 and 128 and length(trim(${table.model})) between 1 and 128 and ${table.historyRevision} >= 0`
    ),
    check(
      'ai_generation_attempts_bucket_check',
      sql`length(${table.usageBucketDate}) = 10 and date(${table.usageBucketDate}) is not null and date(${table.usageBucketDate}) = ${table.usageBucketDate}`
    ),
    check(
      'ai_generation_attempts_status_check',
      sql`${table.status} in ('pending', 'succeeded', 'failed', 'indeterminate', 'refused', 'cancelled')`
    ),
    check(
      'ai_generation_attempts_provider_metadata_check',
      sql`(${table.providerRequestId} is null or length(trim(${table.providerRequestId})) between 1 and 512) and (${table.inputTokens} is null or ${table.inputTokens} >= 0) and (${table.outputTokens} is null or ${table.outputTokens} >= 0) and (${table.reasoningTokens} is null or ${table.reasoningTokens} >= 0) and (${table.cachedInputTokens} is null or ${table.cachedInputTokens} >= 0) and (${table.cacheWriteTokens} is null or ${table.cacheWriteTokens} >= 0) and (${table.errorCode} is null or (length(${table.errorCode}) between 1 and 64 and ${table.errorCode} not glob '*[^a-z0-9_-]*'))`
    ),
    check(
      'ai_generation_attempts_lifecycle_check',
      sql`(${table.status} = 'pending' and ${table.leaseExpiresAt} is not null and julianday(${table.leaseExpiresAt}) is not null and ${table.completedAt} is null and ${table.assistantMessageId} is null and ${table.errorCode} is null) or (${table.status} = 'succeeded' and ${table.leaseExpiresAt} is null and ${table.completedAt} is not null and julianday(${table.completedAt}) is not null and ${table.assistantMessageId} is not null and ${table.errorCode} is null) or (${table.status} = 'refused' and ${table.leaseExpiresAt} is null and ${table.completedAt} is not null and julianday(${table.completedAt}) is not null and ${table.assistantMessageId} is not null and ${table.errorCode} is not null) or (${table.status} in ('failed', 'indeterminate', 'cancelled') and ${table.leaseExpiresAt} is null and ${table.completedAt} is not null and julianday(${table.completedAt}) is not null and ${table.assistantMessageId} is null and ${table.errorCode} is not null)`
    ),
    check(
      'ai_generation_attempts_timestamps_check',
      sql`julianday(${table.createdAt}) is not null and julianday(${table.updatedAt}) is not null and julianday(${table.updatedAt}) >= julianday(${table.createdAt}) and (${table.leaseExpiresAt} is null or julianday(${table.leaseExpiresAt}) >= julianday(${table.createdAt})) and (${table.completedAt} is null or julianday(${table.completedAt}) >= julianday(${table.createdAt}))`
    )
  ]
)

export const aiGenerationLeases = sqliteTable(
  'ai_generation_leases',
  {
    ownerUserId: text('owner_user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'restrict' }),
    attemptId: text('attempt_id').notNull(),
    leaseExpiresAt: text('lease_expires_at').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    check(
      'ai_generation_leases_identity_check',
      sql`length(trim(${table.ownerUserId})) > 0 and length(${table.attemptId}) = 47 and substr(${table.attemptId}, 1, 11) = 'ai_attempt_' and substr(${table.attemptId}, 20, 1) = '-' and substr(${table.attemptId}, 25, 1) = '-' and substr(${table.attemptId}, 26, 1) = '4' and substr(${table.attemptId}, 30, 1) = '-' and substr(${table.attemptId}, 31, 1) in ('8', '9', 'a', 'b') and substr(${table.attemptId}, 35, 1) = '-' and replace(substr(${table.attemptId}, 12), '-', '') not glob '*[^0-9a-f]*'`
    ),
    check(
      'ai_generation_leases_timestamps_check',
      sql`julianday(${table.leaseExpiresAt}) is not null and julianday(${table.createdAt}) is not null and julianday(${table.updatedAt}) is not null and julianday(${table.leaseExpiresAt}) >= julianday(${table.createdAt}) and julianday(${table.updatedAt}) >= julianday(${table.createdAt})`
    )
  ]
)

export const aiUsageBuckets = sqliteTable(
  'ai_usage_buckets',
  {
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    bucketDate: text('bucket_date').notNull(),
    requestCount: integer('request_count').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    primaryKey({ columns: [table.ownerUserId, table.bucketDate], name: 'ai_usage_buckets_owner_date_pk' }),
    check(
      'ai_usage_buckets_date_check',
      sql`length(${table.bucketDate}) = 10 and date(${table.bucketDate}) is not null and date(${table.bucketDate}) = ${table.bucketDate}`
    ),
    check(
      'ai_usage_buckets_counts_check',
      sql`${table.requestCount} >= 0 and ${table.inputTokens} >= 0 and ${table.outputTokens} >= 0 and ${table.reasoningTokens} >= 0 and ${table.cachedInputTokens} >= 0 and ${table.cacheWriteTokens} >= 0`
    ),
    check(
      'ai_usage_buckets_timestamps_check',
      sql`julianday(${table.createdAt}) is not null and julianday(${table.updatedAt}) is not null and julianday(${table.updatedAt}) >= julianday(${table.createdAt})`
    )
  ]
)

export type AiMessageRole = (typeof aiMessageRoles)[number]
export type AiGenerationAttemptStatus = (typeof aiGenerationAttemptStatuses)[number]
