export type UnitedFrontEndorser = Readonly<{
  name: string
  logoSrc: string
}>

// Keep this array in the order organizations endorse the declaration. New entries append at the end.
export const unitedFrontEndorsers = [
  {
    name: 'Working Class Unity',
    logoSrc: '/images/wcu-logo-dark.png'
  }
] as const satisfies readonly UnitedFrontEndorser[]
