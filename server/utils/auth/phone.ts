import { createHmac } from 'node:crypto'
import { isTemporaryPhoneEmail } from '../../../shared/account-identity'

const usPhoneDigitsPattern = /^[2-9]\d{2}[2-9]\d{6}$/

export function normalizeUsPhoneNumber(value: string): string | null {
  const normalized = value.trim()
  if (!normalized || !/^[+\d()\-\s]+$/.test(normalized)) return null

  const digits = normalized.replaceAll(/\D/g, '')
  const nationalNumber = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (nationalNumber.length !== 10 || !usPhoneDigitsPattern.test(nationalNumber)) return null
  return `+1${nationalNumber}`
}

export function temporaryPhoneEmail(secret: string, phoneNumber: string): string {
  const normalized = normalizeUsPhoneNumber(phoneNumber)
  if (!normalized) throw new TypeError('A canonical United States phone number is required')
  const digest = createHmac('sha256', secret).update(normalized).digest('hex')
  return `phone-${digest}@accounts.invalid`
}

export { isTemporaryPhoneEmail }
