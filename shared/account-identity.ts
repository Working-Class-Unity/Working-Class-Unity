const temporaryPhoneEmailPattern = /^phone-[a-f0-9]{64}@accounts\.invalid$/

export function isTemporaryPhoneEmail(value: string): boolean {
  return temporaryPhoneEmailPattern.test(value)
}
