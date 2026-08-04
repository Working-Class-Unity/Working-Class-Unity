export const aiPolicy = Object.freeze({
  maximumConversationCount: 100,
  maximumUserMessageBytes: 32_000,
  maximumRenderedInputBytes: 200_000,
  maximumOutputTokens: 4_096,
  providerTimeoutMs: 60_000,
  attemptLeaseMs: 90_000,
  dailyProviderAttemptLimit: 50,
  maximumConcurrentGenerationsPerUser: 1,
  defaultPageSize: 50,
  maximumPageSize: 100
})

export function utf8ByteLength(value: string) {
  return Buffer.byteLength(value, 'utf8')
}
