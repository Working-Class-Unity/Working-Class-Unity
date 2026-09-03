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
    'Our tax dollars should fund safety measures that working people can help shape and trust, not a private surveillance system City Council rubber-stamps and residents cannot control.',
  qualification:
    'WCU starts from a different idea of public safety. Working people should have democratic control over the institutions, budgets, and technologies that shape our lives. Safety should be built through stable homes, safe jobs, care, prevention, and public systems we can inspect and direct.',
  sections: [
    {
      id: 'verified-facts',
      title: 'What Stockton records show',
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
      summary: 'The case rests on safety, unequal exposure to institutional power, and public control of public money.',
      points: [
        {
          text: 'Working people deserve safety rooted in stable homes, safe jobs, reliable public services, care, and institutions they can hold accountable.'
        },
        {
          text: 'Flock records ordinary travel and turns it into searchable data. Collection may be broad, but the risks fall hardest on people already exposed to police, immigration authorities, employers, landlords, or abusive partners.'
        },
        {
          text: 'The public pays, police gain more capacity, and a private vendor receives recurring revenue. Residents gain no matching power over the system.'
        }
      ]
    },
    {
      id: 'removal-demand',
      title: petitionDemand.title,
      summary: 'The full petition language appears here without editorial changes.',
      paragraphs: [{ text: petitionDemand.introduction }],
      points: petitionDemand.demands.map((text) => ({ text }))
    },
    {
      id: 'system',
      title: 'Stockton bought a system, not a single tool',
      summary:
        'City records describe a package that reaches from routine movement records to emergency response, live observation, and private vendor infrastructure.',
      paragraphs: [
        {
          text: 'The records establish what Stockton authorized or purchased—not that every product is deployed or every connection is active.'
        }
      ],
      points: [
        { text: 'Plate readers create records of plates, vehicle details, times, and locations.' },
        {
          text: 'The package includes alerts, plate searches, 911 response tools, and connections to compatible video.'
        },
        {
          text: 'The 2026 quote lists six drones and docks, two radar units, a mobile trailer, and ten compatible video streams.'
        },
        {
          text: 'Flock supplies the software, permissions, support, subscriptions, and contract terms behind the package.'
        }
      ]
    },
    {
      id: 'safeguards',
      title: 'Rules can reduce harm. They cannot end routine mass collection.',
      summary: 'An immigration-enforcement ban and strict access rules serve only as a temporary band-aid.',
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
      summary: 'Stockton should build public capacity in place of private surveillance dependence.',
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
      summary: 'A petition signature begins the work. Organized residents must carry it through.',
      points: [
        { text: 'Sign and share the demand letter.' },
        { text: 'Talk with Stockton residents through side-quest outreach.' },
        { text: 'Review records and help separate established facts from open questions.' },
        { text: 'Prepare for public action and stay involved after a council vote.' }
      ]
    }
  ],
  sources: [...stocktonSources, ...safeguardsSources]
} as const satisfies CampaignPageContent
