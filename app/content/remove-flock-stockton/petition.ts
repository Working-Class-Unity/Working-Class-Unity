const introduction =
  'By signing, I urge the Stockton City Council to pass a Flock Removal Resolution that ends this surveillance system, prevents it from returning under another name, and restores meaningful public control over how surveillance technology is funded and used.'

const demands = [
  'Terminate or decline to renew every Flock contract at the earliest lawful date, and prohibit automatic renewal.',
  'Immediately stop new Flock purchases, tools, integrations, data-sharing arrangements, deployments, and expansions.',
  'Require deletion, to the fullest extent permitted by law, of all Flock-collected vehicle, image, video, and location data held by the city, Flock, or authorized third parties. Any data that cannot legally be deleted should be publicly identified, along with the reason it must be retained and the date it will be destroyed.',
  'Publish a complete inventory and public closeout record. This should include all Flock equipment, contracts, integrations, data-sharing relationships, and access permissions; an audit of who accessed or received Stockton data and for what stated purpose; a dated deactivation and removal schedule; and a final closeout report confirming that the system has been dismantled.',
  'Prohibit Stockton from recreating the same mass-tracking system under another name. City funds, grants, contracts, purchasing authority, or staff resources should not be used to acquire, operate, renew, or expand Flock or any substantially similar system that routinely records and makes searchable the movements of people who are not suspected of wrongdoing—regardless of vendor, brand, or funding source.'
] as const

export const petitionDemand = Object.freeze({
  title: 'What the Flock Removal Resolution Must Do',
  introduction,
  leadIn: 'The resolution should:',
  demands,
  unavailableLabel: 'Petition link coming soon'
})

export const petitionDemandCanonicalText = [
  introduction,
  '',
  'The resolution should:',
  '',
  ...demands.flatMap((demand, index) => [`${index + 1}. ${demand}`, ...(index === demands.length - 1 ? [] : [''])])
].join('\n')
