export type UnitedFrontEndorser = Readonly<{
  name: string
  logoSrc: string
}>

// Keep this array in the order organizations endorse the declaration. New entries append at the end.
export const unitedFrontEndorsers = [
  {
    name: 'Working Class Unity',
    logoSrc: '/images/wcu-logo-dark.png'
  },
  {
    name: 'Campesinos Independientes',
    logoSrc: '/images/campesinos-independientes-logo.png'
  },
  {
    name: 'Papeles Para Todos',
    logoSrc: '/images/papeles-para-todos-logo.png'
  }
] as const satisfies readonly UnitedFrontEndorser[]
