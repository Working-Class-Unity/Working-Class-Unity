import { describe, expect, it } from 'vitest'
import { resolveSentryServerPreloadConfiguration } from '../shared/sentry-environment'

const completeEnvironment = {
  NUXT_PUBLIC_SENTRY_DSN: 'https://public@example.test/2',
  NUXT_SENTRY_DSN: 'https://private@example.test/1'
} as const

describe('Sentry server preload environment', () => {
  it('stays inactive without complete DSNs', () => {
    expect(resolveSentryServerPreloadConfiguration({})).toBeUndefined()
  })

  it.each([
    { key: 'NUXT_SENTRY_DSN', value: '' },
    { key: 'NUXT_SENTRY_DSN', value: ' https://private@example.test/1' },
    { key: 'NUXT_SENTRY_DSN', value: 'ftp://private@example.test/1' },
    { key: 'NUXT_PUBLIC_SENTRY_DSN', value: 'not a URL' },
    { key: 'NUXT_SENTRY_TRACES_SAMPLE_RATE', value: '' },
    { key: 'NUXT_SENTRY_TRACES_SAMPLE_RATE', value: 'NaN' },
    { key: 'NUXT_SENTRY_TRACES_SAMPLE_RATE', value: '-0.1' },
    { key: 'NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE', value: '1.1' }
  ])('fails closed for invalid $key', ({ key, value }) => {
    expect(
      resolveSentryServerPreloadConfiguration({
        ...completeEnvironment,
        [key]: value
      })
    ).toBeUndefined()
  })

  it('uses safe defaults without inventing a release', () => {
    expect(
      resolveSentryServerPreloadConfiguration({
        ...completeEnvironment,
        NODE_ENV: 'production'
      })
    ).toEqual({
      dsn: completeEnvironment.NUXT_SENTRY_DSN,
      environment: 'production',
      tracesSampleRate: 0.05
    })
  })

  it('retains exact explicit environment, release, and boundary sample rates', () => {
    expect(
      resolveSentryServerPreloadConfiguration({
        ...completeEnvironment,
        NUXT_PUBLIC_SENTRY_RELEASE: 'release-from-public-runtime',
        NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '1',
        NUXT_SENTRY_ENVIRONMENT: 'staging',
        NUXT_SENTRY_TRACES_SAMPLE_RATE: '0'
      })
    ).toEqual({
      dsn: completeEnvironment.NUXT_SENTRY_DSN,
      environment: 'staging',
      release: 'release-from-public-runtime',
      tracesSampleRate: 0
    })
  })

  it('accepts loopback HTTP inputs and uses the final environment fallback', () => {
    expect(
      resolveSentryServerPreloadConfiguration({
        ...completeEnvironment,
        NUXT_PUBLIC_SENTRY_DSN: 'http://public@127.0.0.1:9/2',
        NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '0.25',
        NUXT_SENTRY_DSN: 'http://private@127.0.0.1:9/1',
        NUXT_SENTRY_RELEASE: 'server-release',
        NUXT_SENTRY_TRACES_SAMPLE_RATE: '0.5'
      })
    ).toEqual({
      dsn: 'http://private@127.0.0.1:9/1',
      environment: 'development',
      release: 'server-release',
      tracesSampleRate: 0.5
    })
  })
})
