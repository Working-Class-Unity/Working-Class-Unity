import { isIP } from 'node:net'
import {
  isMembershipDuesOfferingKey,
  membershipDuesOfferingKeys,
  type BillingOfferingKey
} from '../../../../shared/billing'

export type BillingStripePriceConfiguration = Readonly<Record<BillingOfferingKey, string>>

export type BillingStripeRuntimeConfiguration = Readonly<{
  appName: string
  appUrl: string
  stripe: Readonly<{
    secretKey: string
    webhookSecret: string
    portalConfigurationId: string
    prices: BillingStripePriceConfiguration
  }>
}>

export type BillingStripeRuntimeConfigurationInput = BillingStripeRuntimeConfiguration
export type BillingStripeRuntimeEnvironment = Readonly<Record<string, string | undefined>>

export type BillingStripeRuntimeConfigurationIssue = Readonly<{
  code: 'invalid' | 'mismatch' | 'missing'
  key: string
  message: string
}>

const appNameEnvironmentKey = 'NUXT_PUBLIC_APP_NAME'
const appUrlEnvironmentKey = 'NUXT_PUBLIC_APP_URL'
const secretKeyEnvironmentKey = 'NUXT_STRIPE_SECRET_KEY'
const webhookSecretEnvironmentKey = 'NUXT_STRIPE_WEBHOOK_SECRET'
const portalConfigurationEnvironmentKey = 'NUXT_STRIPE_PORTAL_CONFIGURATION_ID'
const priceEnvironmentKeys = {
  'personal.monthly': 'NUXT_STRIPE_MEMBERSHIP_DUES10_PRICE_ID',
  'family.monthly': 'NUXT_STRIPE_SOLIDARITY_DUES27_PRICE_ID'
} as const satisfies Record<(typeof membershipDuesOfferingKeys)[number], string>
const legacyPriceIds = {
  'personal.monthly': 'membership-10-1month',
  'family.monthly': 'solidarity-27-1month'
} as const satisfies Record<(typeof membershipDuesOfferingKeys)[number], string>

export function isStripePriceIdForOffering(offering: BillingOfferingKey, priceId: string): boolean {
  return priceId.startsWith('price_') || (isMembershipDuesOfferingKey(offering) && priceId === legacyPriceIds[offering])
}

export function evaluateBillingStripeRuntimeConfiguration(
  input: BillingStripeRuntimeConfigurationInput,
  environment: BillingStripeRuntimeEnvironment = process.env
): readonly BillingStripeRuntimeConfigurationIssue[] {
  const issues: BillingStripeRuntimeConfigurationIssue[] = []

  validateRequiredValue(input.appName, appNameEnvironmentKey, environment, issues)
  const appUrl = validateRequiredValue(input.appUrl, appUrlEnvironmentKey, environment, issues)
  validateAppUrl(appUrl, issues)

  const secretKey = validateRequiredValue(input.stripe.secretKey, secretKeyEnvironmentKey, environment, issues)
  if (secretKey && !/^rk_(?:test|live)_[A-Za-z0-9_]+$/.test(secretKey)) {
    issues.push(configurationIssue('invalid', secretKeyEnvironmentKey, 'must be a Stripe restricted API key'))
  }

  const webhookSecret = validateRequiredValue(
    input.stripe.webhookSecret,
    webhookSecretEnvironmentKey,
    environment,
    issues
  )
  if (webhookSecret && !/^whsec_[A-Za-z0-9_]+$/.test(webhookSecret)) {
    issues.push(configurationIssue('invalid', webhookSecretEnvironmentKey, 'must be a Stripe webhook signing secret'))
  }

  const portalConfigurationId = validateRequiredValue(
    input.stripe.portalConfigurationId,
    portalConfigurationEnvironmentKey,
    environment,
    issues
  )
  if (portalConfigurationId && !portalConfigurationId.startsWith('bpc_')) {
    issues.push(
      configurationIssue(
        'invalid',
        portalConfigurationEnvironmentKey,
        'must be a Stripe Billing Portal configuration ID'
      )
    )
  }

  const environmentKeysByPriceId = new Map<string, string[]>()
  for (const offering of membershipDuesOfferingKeys) {
    const environmentKey = priceEnvironmentKeys[offering]
    const priceId = validateRequiredValue(input.stripe.prices[offering], environmentKey, environment, issues)
    if (priceId && !isStripePriceIdForOffering(offering, priceId)) {
      issues.push(configurationIssue('invalid', environmentKey, 'must be a Stripe Price ID'))
    }
    if (priceId) {
      const keys = environmentKeysByPriceId.get(priceId) ?? []
      keys.push(environmentKey)
      environmentKeysByPriceId.set(priceId, keys)
    }
  }

  for (const keys of environmentKeysByPriceId.values()) {
    if (keys.length < 2) continue
    for (const key of keys) {
      issues.push(configurationIssue('invalid', key, 'must be distinct from every other configured Stripe Price ID'))
    }
  }

  return Object.freeze(issues)
}

function validateRequiredValue(
  resolved: string,
  key: string,
  environment: BillingStripeRuntimeEnvironment,
  issues: BillingStripeRuntimeConfigurationIssue[]
): string {
  const raw = environment[key] ?? ''
  if (!raw.trim()) {
    issues.push(configurationIssue('missing', key, 'is required'))
  }
  if (raw && raw !== raw.trim()) {
    issues.push(configurationIssue('invalid', key, 'must be already trimmed'))
  }
  if (resolved !== raw) {
    issues.push(configurationIssue('mismatch', key, 'did not resolve from the runtime environment'))
  }
  return raw.trim()
}

function validateAppUrl(value: string, issues: BillingStripeRuntimeConfigurationIssue[]): void {
  if (!value) return

  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return
    if (url.protocol === 'http:' && isLoopbackHostname(url.hostname)) return
  } catch {
    // The keyed issue below covers both invalid URLs and unsupported protocols.
  }

  issues.push(
    configurationIssue(
      'invalid',
      appUrlEnvironmentKey,
      'must be an absolute HTTPS URL, except that HTTP is allowed for loopback hosts'
    )
  )
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '::1') return true
  return isIP(normalized) === 4 && normalized.split('.')[0] === '127'
}

function configurationIssue(
  code: BillingStripeRuntimeConfigurationIssue['code'],
  key: string,
  message: string
): BillingStripeRuntimeConfigurationIssue {
  return Object.freeze({ code, key, message })
}
