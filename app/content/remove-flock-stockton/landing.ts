import { petitionDemand } from './petition'
import { safeguardsSources, stocktonSources } from './sources'
import type { CampaignFact, CampaignPageContent } from './types'

export const campaignFacts = [
  {
    value: 'Through 2031',
    label: 'Contract term',
    detail: 'Stockton extended the Flock agreement through April 14, 2031.',
    sourceIds: ['stockton-mar-2026-staff-report', 'stockton-mar-2026-amendment']
  },
  {
    value: '$5.4M+',
    label: 'Potential contract value',
    detail: 'City records state a maximum of $5,416,700 after the March 2026 amendment.',
    sourceIds: ['stockton-mar-2026-staff-report', 'stockton-mar-2026-amendment']
  },
  {
    value: 'A connected system',
    label: 'More than cameras',
    detail:
      'The contracted package joins plate readers, emergency-response software, drones, radar, video streams, and search tools.',
    sourceIds: ['stockton-nov-2024-amendment', 'stockton-mar-2026-amendment']
  }
] as const satisfies readonly CampaignFact[]

export const campaignLandingPage = {
  path: '/campaigns/remove-flock-stockton',
  eyebrow: 'A WORKING CLASS UNITY SIDE-QUEST',
  title: 'Remove Mass Surveillance from Stockton',
  description:
    'Working people in Stockton are being made to fund a private surveillance system that City Council approved and residents do not control. The amended Flock contract can cost as much as $5,416,700 and run through April 14, 2031. It records ordinary travel and expands police search and observation power. Our tax dollars should instead build safety that working people decide on and trust.',
  reviewedThrough: 'September 3, 2026',
  qualification:
    'We start from a different idea of public safety. Working people should have democratic control over the institutions, budgets, and technologies that shape our lives. Safety should rest on stable homes, safe jobs, prevention, and public systems we can inspect and direct. Removing Flock is one step toward working people governing the resources and institutions that shape our lives.',
  sections: [
    {
      id: 'verified-facts',
      title: "Flock isn't just license plate readers.",
      summary: 'Three facts orient the side-quest without turning contract claims into proof of deployment.',
      paragraphs: [
        {
          text: 'Stockton approved a contract expansion through 2031 with a stated potential value above $5.4 million.',
          sourceIds: ['stockton-mar-2026-staff-report', 'stockton-mar-2026-amendment']
        },
        {
          text: 'The package goes beyond license-plate cameras. City records describe emergency-response software, drones, radar, integrated video streams, and search tools.',
          sourceIds: ['stockton-nov-2024-amendment', 'stockton-mar-2026-amendment']
        }
      ]
    },
    {
      id: 'why-remove',
      title: 'Why Stockton should remove Flock',
      summary:
        "Working people need safety without routine tracking. Stockton's contract directs public money to a private vendor and expands police capacity, but gives residents no matching control over the system.",
      points: [
        {
          text: 'Working people deserve safety rooted in stable homes, safe jobs, reliable public services, and institutions we can hold accountable.'
        },
        {
          text: 'Flock records ordinary travel and turns it into searchable data. Collection may be broad, but the risks fall hardest on people already exposed to police, immigration authorities, employers, landlords, or abusive partners.'
        },
        {
          text: 'Working people fund the contract, police gain more capacity, and a private vendor receives recurring revenue. Residents gain no matching power over the system.'
        }
      ]
    },
    {
      id: 'removal-demand',
      title: petitionDemand.title,
      summary: petitionDemand.leadIn,
      paragraphs: [{ text: petitionDemand.introduction }],
      points: petitionDemand.demands.map((text) => ({ text }))
    },
    {
      id: 'system',
      title: 'Stockton bought a system, not a single tool',
      summary: 'Collection, search, aerial observation, and vendor infrastructure work as one connected platform.',
      points: [
        { text: 'License plates, vehicle details, time, and location.' },
        {
          text: 'Alerts, emergency-response links, plate lookups, and connected video.'
        },
        {
          text: 'Six contracted drones and docks, radar, and live streams.'
        },
        {
          text: 'Vendor software, permissions, support, subscriptions, and contract terms.'
        }
      ]
    },
    {
      id: 'safeguards',
      title: 'Rules can reduce harm. They cannot end routine mass collection.',
      summary:
        'An immigration enforcement ban and strict access rules would serve only as a temporary band-aid. Such rules can reduce harm, but the final demand remains removal.',
      paragraphs: [
        {
          text: 'A written rule does not erase the power that the system places in police hands.'
        },
        {
          text: 'Other California cities found gaps between written policy and the platform settings or network access in practice.',
          sourceIds: ['mountain-view-termination', 'oxnard-suspension', 'los-altos-community-message']
        }
      ]
    },
    {
      id: 'real-safety',
      title: 'Safety should make people more secure, not more searchable',
      summary:
        'Stockton should build public capacity in place of dependence on a private surveillance vendor. Working people should decide what safety budgets fund and govern the institutions that carry that work out.',
      points: [
        { text: 'Stable homes: housing security, repairs, and protection from retaliation.' },
        {
          text: 'Safe work and public space: dependable infrastructure, lighting, transit, and workplace protections.'
        },
        {
          text: 'Care and prevention: youth programs, crisis response, violence prevention, and support for survivors.'
        },
        { text: 'Public control: institutions residents can inspect, shape, and hold accountable.' }
      ]
    },
    {
      id: 'participate',
      title: 'Signing is the first step',
      summary:
        'A petition signature begins the work. We must organize with other Stockton residents to carry these demands through and stay organized after a council vote.',
      closingParagraphs: [
        {
          text: 'Each step should leave us with more shared knowledge and a stronger organization for the next fight. The longer struggle is for working people to control the budgets, institutions, and technologies that shape our lives.'
        }
      ],
      points: [
        { text: 'Sign and share the demand letter.' },
        { text: 'Talk with other Stockton residents about the campaign and invite them to act with us.' },
        { text: 'Review records and help separate established facts from open questions.' },
        { text: 'Prepare for public action and stay involved after a council vote.' }
      ]
    }
  ],
  sources: [...stocktonSources, ...safeguardsSources]
} as const satisfies CampaignPageContent
