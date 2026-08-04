import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { magicLink, mcp, oidcProvider } from 'better-auth/plugins'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { describe, expect, it } from 'vitest'
import * as schema from '../server/db/schema'

const redirectSchemas = [
  ['OIDC provider', oidcProvider({ loginPage: '/login' }).endpoints.registerOAuthApplication.options.body],
  ['MCP', mcp({ loginPage: '/login' }).endpoints.registerMcpClient.options.body]
] as const

describe('Better Auth advisory and adapter compatibility', () => {
  it.each(redirectSchemas)('%s rejects script-capable redirect protocols', async (_name, bodySchema) => {
    for (const redirectUri of ['javascript:alert(1)', 'data:text/html,unsafe', 'vbscript:msgbox(1)']) {
      const result = await bodySchema.safeParseAsync(redirectPayload(redirectUri))
      expect(result.success, `${redirectUri} must be rejected`).toBe(false)
    }
    for (const redirectUri of ['https://example.com/callback', 'http://127.0.0.1:3000/callback']) {
      const result = await bodySchema.safeParseAsync(redirectPayload(redirectUri))
      expect(result.success, `${redirectUri} must be accepted`).toBe(true)
    }
  })

  it('initializes Better Auth through the dedicated adapter with disposable SQLite Drizzle state', async () => {
    const sqlite = new Database(':memory:')

    try {
      const database = drizzle({ client: sqlite, schema })
      const authentication = betterAuth({
        baseURL: 'http://127.0.0.1:3000',
        secret: 'test-only-better-auth-compatibility-secret',
        database: drizzleAdapter(database, {
          provider: 'sqlite',
          schema
        }),
        disabledPaths: ['/sign-up/email', '/sign-in/email'],
        emailAndPassword: {
          enabled: false
        },
        verification: {
          storeInDatabase: true
        },
        plugins: [
          magicLink({
            expiresIn: 300,
            storeToken: 'hashed',
            rateLimit: { window: 60, max: 5 },
            sendMagicLink: async () => undefined
          })
        ]
      })

      const context = await authentication.$context

      expect(context.adapter).toBeDefined()
      expect(context.options.emailAndPassword?.enabled).toBe(false)
      expect(context.options.verification?.storeInDatabase).toBe(true)
      expect(context.options.disabledPaths).toEqual(expect.arrayContaining(['/sign-up/email', '/sign-in/email']))
      expect(context.options.plugins?.find((plugin) => plugin.id === 'magic-link')?.options).toMatchObject({
        expiresIn: 300,
        storeToken: 'hashed',
        rateLimit: { window: 60, max: 5 }
      })
      expect(authentication.api.signInMagicLink).toBeTypeOf('function')
      expect(authentication.api.magicLinkVerify).toBeTypeOf('function')
    } finally {
      sqlite.close()
    }
  })
})

function redirectPayload(redirectUri: string) {
  return {
    client_name: 'Security fixture',
    redirect_uris: [redirectUri]
  }
}
