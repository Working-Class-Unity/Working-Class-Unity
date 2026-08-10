export const profileNameMaxLength = 100

export const profileUserFields = {
  firstName: {
    type: 'string',
    required: false,
    returned: false
  },
  lastName: {
    type: 'string',
    required: false,
    returned: false
  },
  displayName: {
    type: 'string',
    required: false,
    returned: true
  }
} as const

export type AccountProfile = {
  firstName: string | null
  lastName: string | null
  displayName: string | null
}
