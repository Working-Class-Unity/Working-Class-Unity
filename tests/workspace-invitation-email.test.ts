import { describe, expect, it } from 'vitest'
import { createWorkspaceInvitationEmail, TransactionalEmailDeliveryError } from '../server/services/email'
import { createPasswordlessAuthBeforeHook } from '../server/utils/auth/passwordless'
import { createSocialAuthBeforeHook } from '../server/utils/auth/social'
import type { AppRuntimeConfig } from '../server/utils/runtime'

describe('workspace invitation email and auth return path', () => {
  it('preserves the exact invitation success path through passwordless request and redemption hooks', async () => {
    const before = createPasswordlessAuthBeforeHook('https://app.example.test')
    const returnPath = '/invite/Invite_123-opaque'

    await expect(
      before({
        path: '/sign-in/magic-link',
        headers: new Headers({ origin: 'https://app.example.test' }),
        body: {
          callbackURL: returnPath,
          newUserCallbackURL: returnPath,
          errorCallbackURL: '/login'
        }
      } as never)
    ).resolves.toBeUndefined()
    await expect(
      before({
        path: '/magic-link/verify',
        query: { callbackURL: returnPath, newUserCallbackURL: returnPath, errorCallbackURL: '/login' }
      } as never)
    ).resolves.toBeUndefined()
    await expect(
      before({
        path: '/sign-in/magic-link',
        body: {
          callbackURL: `${returnPath}?leak=true`,
          newUserCallbackURL: returnPath,
          errorCallbackURL: '/login'
        }
      } as never)
    ).rejects.toMatchObject({ statusCode: 400, body: { code: 'INVALID_REQUEST' } })
  })

  it('preserves the same exact invitation success path through the guarded Google handoff', async () => {
    const returnPath = '/invite/Google_invite-123'
    const before = createSocialAuthBeforeHook({
      betterAuth: { url: 'https://app.example.test' },
      socialProviders: {
        google: {
          enabled: true,
          clientId: 'client.apps.googleusercontent.com',
          clientSecret: 'client-secret'
        }
      }
    } as AppRuntimeConfig)

    await expect(
      before({
        path: '/sign-in/social',
        headers: new Headers({ origin: 'https://app.example.test' }),
        body: {
          provider: 'google',
          callbackURL: returnPath,
          newUserCallbackURL: returnPath,
          errorCallbackURL: '/login'
        }
      } as never)
    ).resolves.toBeUndefined()
    await expect(
      before({
        path: '/sign-in/social',
        headers: new Headers({ origin: 'https://app.example.test' }),
        body: {
          provider: 'google',
          callbackURL: `${returnPath}/extra`,
          newUserCallbackURL: returnPath,
          errorCallbackURL: '/login'
        }
      } as never)
    ).rejects.toMatchObject({ statusCode: 400, body: { code: 'INVALID_REQUEST' } })
  })

  it('safely renders one opaque application link in each message representation', () => {
    const url = 'https://app.example.test/invite/Opaque_123-link'
    const message = createWorkspaceInvitationEmail({
      to: 'person@example.test',
      url,
      appName: 'Family & Friends',
      workspaceName: '<Shared>\nHome'
    })

    expect(message).toMatchObject({
      to: 'person@example.test',
      subject: 'Workspace invitation'
    })
    expect(message.text).toContain('join <Shared> Home on Family & Friends as a member')
    expect(message.html).toContain('&lt;Shared&gt; Home')
    expect(message.html).toContain('Family &amp; Friends')
    expect(message.html).not.toContain('<Shared>')
    expect(message.text.match(new RegExp(url, 'g'))).toHaveLength(1)
    expect(message.html.match(new RegExp(url, 'g'))).toHaveLength(1)
  })

  it('rejects unsafe recipients, URLs, and display text at the renderer boundary', () => {
    const base = {
      to: 'person@example.test',
      url: 'https://app.example.test/invite/Opaque_123-link',
      appName: 'Baseline App',
      workspaceName: 'Shared Home'
    }

    expect(() =>
      createWorkspaceInvitationEmail({ ...base, to: 'person@example.test\nBcc: hidden@example.test' })
    ).toThrow(TransactionalEmailDeliveryError)
    expect(() => createWorkspaceInvitationEmail({ ...base, url: 'javascript:alert(1)' })).toThrow(
      TransactionalEmailDeliveryError
    )
    expect(() => createWorkspaceInvitationEmail({ ...base, workspaceName: '\r\n' })).toThrow(
      TransactionalEmailDeliveryError
    )
  })
})
