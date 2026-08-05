import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMagicLinkEmail,
  createTransactionalEmailSender,
  TransactionalEmailDeliveryError
} from '../server/services/email'

const resend = vi.hoisted(() => ({
  construct: vi.fn(),
  send: vi.fn()
}))

vi.mock('resend', () => ({
  Resend: class {
    readonly emails = { send: resend.send }

    constructor(apiKey: string) {
      resend.construct(apiKey)
    }
  }
}))

const config = {
  transport: 'resend',
  from: 'Working Class Unity <no-reply@example.test>',
  captureDirectory: '',
  resend: {
    apiKey: 're_private-test-key'
  }
} as const

describe('Resend transactional email boundary', () => {
  beforeEach(() => {
    resend.construct.mockReset()
    resend.send.mockReset()
    resend.send.mockResolvedValue({ data: { id: 'email_test' }, error: null })
  })

  it('sends normalized content and forwards an explicit idempotency key separately', async () => {
    const sender = createTransactionalEmailSender(config)

    await sender.send({
      to: 'member@example.test',
      subject: 'Membership update',
      text: 'Your membership was updated.',
      html: '<p>Your membership was updated.</p>',
      idempotencyKey: 'a'.repeat(64)
    })

    expect(resend.construct).toHaveBeenCalledWith('re_private-test-key')
    expect(resend.send).toHaveBeenCalledWith(
      {
        from: 'Working Class Unity <no-reply@example.test>',
        to: 'member@example.test',
        subject: 'Membership update',
        text: 'Your membership was updated.',
        html: '<p>Your membership was updated.</p>'
      },
      { idempotencyKey: 'a'.repeat(64) }
    )
  })

  it('does not invent idempotency for magic-link delivery', async () => {
    const sender = createTransactionalEmailSender(config)

    await sender.send(
      createMagicLinkEmail({
        appName: 'Working Class Unity',
        to: 'member@example.test',
        url: 'https://workingclassunity.com/api/auth/magic-link/verify?token=private'
      })
    )

    expect(resend.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'member@example.test' }), undefined)
  })

  it('normalizes returned provider errors without exposing provider details', async () => {
    resend.send.mockResolvedValueOnce({
      data: null,
      error: { message: 'private provider detail', name: 'validation_error' }
    })
    const sender = createTransactionalEmailSender(config)

    const failure = await sender
      .send({
        to: 'member@example.test',
        subject: 'Membership update',
        text: 'Your membership was updated.',
        html: '<p>Your membership was updated.</p>'
      })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(TransactionalEmailDeliveryError)
    expect((failure as Error).message).toBe('Transactional email delivery failed')
    expect((failure as Error).message).not.toContain('private provider detail')
  })

  it('rejects invalid idempotency keys before provider delivery', async () => {
    const sender = createTransactionalEmailSender(config)
    const baseMessage = {
      to: 'member@example.test',
      subject: 'Membership update',
      text: 'Your membership was updated.',
      html: '<p>Your membership was updated.</p>'
    }

    await expect(sender.send({ ...baseMessage, idempotencyKey: 'a'.repeat(257) })).rejects.toThrow(
      TransactionalEmailDeliveryError
    )
    await expect(sender.send({ ...baseMessage, idempotencyKey: 'safe\r\nunsafe' })).rejects.toThrow(
      TransactionalEmailDeliveryError
    )
    expect(resend.send).not.toHaveBeenCalled()
  })
})
