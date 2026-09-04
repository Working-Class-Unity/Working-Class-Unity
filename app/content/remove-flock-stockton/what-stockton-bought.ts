import { stocktonSources } from './sources'
import type { CampaignFact, CampaignPageContent, CampaignTimelineEntry } from './types'

export const stocktonContractFacts = [
  {
    value: '$5,416,700',
    label: 'Stated contract maximum',
    detail:
      'The March 2026 staff report and amendment state this total after Amendment No. 4. Finance records and executed contract copies are still needed to confirm the full cost stack.',
    sourceIds: ['stockton-mar-2026-staff-report', 'stockton-mar-2026-amendment']
  },
  {
    value: 'April 14, 2031',
    label: 'Extended through',
    detail: 'Council approved the term extension on March 31, 2026.',
    sourceIds: ['stockton-mar-2026-agenda', 'stockton-mar-2026-staff-report']
  },
  {
    value: '147 cameras',
    label: 'Reported by Flock’s portal',
    detail:
      'Flock’s public Stockton portal reported 147 cameras on August 8, 2026. City contract-history records described 120 readers. Stockton should publish an authoritative equipment inventory that reconciles the difference.',
    sourceIds: ['stockton-portal-2026-08-08', 'stockton-nov-2024-staff-report', 'stockton-nov-2024-amendment']
  },
  {
    value: '6 drones',
    label: 'Approved package',
    detail:
      'The quote lists six drones with docks, two radar units, Flock911, a trailer, FreeForm, and ten integrated video streams. The public record does not establish whether those products are deployed.',
    sourceIds: ['stockton-mar-2026-staff-report', 'stockton-mar-2026-amendment']
  }
] as const satisfies readonly CampaignFact[]

export const stocktonTimeline = [
  {
    date: 'September 2023',
    action: 'Original Flock contract',
    description:
      'A later staff report says Stockton executed a contract for 15 Flock cameras. Amendment No. 1 records an original amount of $97,400.',
    sourceIds: ['stockton-nov-2024-staff-report', 'stockton-jul-2024-amendment'],
    status: 'verified'
  },
  {
    date: 'July 9, 2024',
    action: 'Prepared 911 integration',
    description:
      'The City Council approved Amendment No. 1 for an amount not to exceed $877,600. The consent agenda passed 6–0 with one member absent.',
    sourceIds: ['stockton-jul-2024-minutes', 'stockton-jul-2024-staff-report', 'stockton-jul-2024-amendment'],
    status: 'verified'
  },
  {
    date: 'November 12, 2024',
    action: 'Federal technology grant',
    description:
      'The City Council accepted a $963,000 COPS Technology and Equipment Program grant and identified a larger plate-reader program among the proposed uses.',
    sourceIds: [
      'stockton-nov-2024-grant-minutes',
      'stockton-nov-2024-grant-report',
      'stockton-nov-2024-grant-award',
      'stockton-nov-2024-grant-resolution'
    ],
    status: 'verified'
  },
  {
    date: 'November 19, 2024',
    action: 'Falcon expansion',
    description:
      'The City Council approved Amendment No. 2 for $1,196,700 to add 105 Falcon units and related software and application programming interfaces. The consent vote passed 7–0.',
    sourceIds: ['stockton-nov-2024-minutes', 'stockton-nov-2024-staff-report', 'stockton-nov-2024-amendment'],
    status: 'verified'
  },
  {
    date: 'March 19, 2025',
    action: 'CEQA notice',
    description: 'A state environmental record names two camera locations. It is not a complete camera map.',
    sourceIds: ['stockton-ceqa-2025'],
    status: 'verified'
  },
  {
    date: 'June 26, 2025',
    action: 'Amendment No. 3',
    description:
      'The March 2026 staff report says the City Manager approved a $95,000 extension. The underlying amendment has not yet been located in the reviewed archive.',
    sourceIds: ['stockton-mar-2026-staff-report'],
    status: 'reported-with-gap'
  },
  {
    date: 'March 31, 2026',
    action: 'Drone as First Responder expansion',
    description:
      'The City Council approved a $3.15 million package and extended the agreement through April 14, 2031. The item passed 7–0 after separate consideration.',
    sourceIds: ['stockton-mar-2026-agenda', 'stockton-mar-2026-staff-report', 'stockton-mar-2026-amendment'],
    status: 'verified'
  }
] as const satisfies readonly CampaignTimelineEntry[]

export const stocktonCostStack = [
  {
    amount: '$97,400',
    label: 'Original contract',
    detail: 'Recorded in the Amendment No. 1 change-order calculator.',
    sourceIds: ['stockton-jul-2024-amendment']
  },
  {
    amount: '$877,600',
    label: 'Amendment No. 1',
    detail: 'Prepared 911 integration.',
    sourceIds: ['stockton-jul-2024-staff-report', 'stockton-jul-2024-amendment']
  },
  {
    amount: '$1,196,700',
    label: 'Amendment No. 2',
    detail: 'Falcon expansion with 105 cameras and related application programming interfaces.',
    sourceIds: ['stockton-nov-2024-staff-report', 'stockton-nov-2024-amendment']
  },
  {
    amount: '$95,000',
    label: 'Amendment No. 3',
    detail: 'Reported in the 2026 staff report; the underlying amendment remains missing from the reviewed archive.',
    sourceIds: ['stockton-mar-2026-staff-report']
  },
  {
    amount: '$3,150,000',
    label: 'Amendment No. 4',
    detail: 'Drone as First Responder package.',
    sourceIds: ['stockton-mar-2026-staff-report', 'stockton-mar-2026-amendment']
  }
] as const

export const whatStocktonBoughtPage = {
  path: '/campaigns/remove-flock-stockton/what-stockton-bought',
  eyebrow: 'THE PUBLIC RECORD',
  title: 'What Stockton Bought',
  description:
    'Working people in Stockton need safety and emergency services they can trust and help govern. City officials used public money to expand a 15-camera Flock contract into privately supplied police infrastructure that connects plate records, emergency calls, video search, drones, radar, and outside data networks. This arrangement expands police power and ties public operations to a private vendor.',
  reviewedThrough: 'September 3, 2026',
  qualification:
    'City contracts and reports establish what Stockton authorized or purchased. Right now, we are not claiming that every contracted product is deployed, that we know how every setting is configured, or that we know who has searched Stockton data.',
  sections: [
    {
      id: 'bottom-line',
      title: 'A platform built in stages',
      summary:
        'Stockton did not make one isolated camera purchase. City officials expanded the system through a sequence of contracts and amendments, committing more public money and making police operations more dependent on Flock’s privately supplied tools.',
      paragraphs: [
        {
          text: 'Stockton records describe an original 15-camera contract, a Prepared 911 integration, a federal grant and 105-camera Falcon expansion, a later amendment whose underlying document remains missing, and a 2026 package for drones, radar, Flock911, a mobile trailer, FreeForm search, and ten integrated video streams.',
          sourceIds: [
            'stockton-jul-2024-staff-report',
            'stockton-nov-2024-grant-report',
            'stockton-nov-2024-staff-report',
            'stockton-mar-2026-staff-report',
            'stockton-mar-2026-amendment'
          ]
        },
        {
          text: 'The March 2026 staff report states that the new package adds $3.15 million, extends the agreement through April 14, 2031, and raises the stated maximum to $5,416,700.',
          sourceIds: ['stockton-mar-2026-staff-report', 'stockton-mar-2026-amendment']
        },
        {
          text: 'City contract-history records described 120 license-plate readers. Flock’s public Stockton portal reported 147 cameras on August 8, 2026. That figure came from vendor-published data preserved by a third party, not a City-certified inventory.',
          sourceIds: ['stockton-nov-2024-staff-report', 'stockton-portal-2026-08-08']
        }
      ]
    },
    {
      id: 'timeline',
      title: 'How the system grew',
      summary:
        'This timeline distinguishes what the City Council approved, what staff reported, and what remains missing from the public archive.'
    },
    {
      id: 'costs',
      title: 'What the contracts could cost',
      summary:
        'The amendment amounts and cumulative contract maximum are different figures. They appear separately here so the same public dollars are not counted twice.',
      paragraphs: [
        {
          text: 'The Drone as First Responder package adds $3.15 million and raises the stated contract maximum to $5.4167 million. Stockton should release the finance records, invoices, purchase orders, and executed contract copies needed to confirm the full cost stack.',
          sourceIds: ['stockton-mar-2026-amendment']
        }
      ]
    },
    {
      id: 'products',
      title: 'What the package contains',
      summary:
        'City records and Flock’s public portal describe a package that combines several kinds of police surveillance and emergency-response technology. The available records establish what was authorized or reported, not what is currently deployed or how it has been used.',
      points: [
        {
          text: 'Plate readers: staff described 15 original cameras and an approved 105-camera expansion. Flock’s archived portal later reported 147 cameras. These figures come from different sources and do not establish the current deployed inventory.',
          sourceIds: ['stockton-nov-2024-staff-report', 'stockton-nov-2024-amendment', 'stockton-portal-2026-08-08']
        },
        {
          text: 'Prepared 911: City documents describe caller location, transcription, translation, caller-provided media, and dispatch tools.',
          sourceIds: ['stockton-jul-2024-staff-report', 'stockton-jul-2024-amendment']
        },
        {
          text: 'Drone package: the quote lists six drones and docks, two radar units, Flock911, a mobile trailer, FreeForm, and ten compatible video streams.',
          sourceIds: ['stockton-mar-2026-staff-report', 'stockton-mar-2026-amendment']
        },
        {
          text: 'Search scale: the figures for ten billion monthly nationwide reads and 500 million monthly regional reads are vendor and staff claims. They do not show that Stockton conducted searches or shared data at that scale.',
          sourceIds: ['stockton-nov-2024-staff-report', 'stockton-nov-2024-amendment']
        }
      ]
    },
    {
      id: 'funding',
      title: 'Public funding and long-term dependence',
      summary:
        'The records name several grant and City funding paths for the Flock system. They do not support a dollar-for-dollar promise to move the full contract amount into another program.',
      paragraphs: [
        {
          text: 'Records name AB109 funds, a federal COPS Technology and Equipment Program grant, Board of State and Community Corrections funds, the Police Department Field Services budget, later grants, and possible City appropriations.',
          sourceIds: [
            'stockton-jul-2024-staff-report',
            'stockton-nov-2024-grant-report',
            'stockton-nov-2024-grant-award',
            'stockton-nov-2024-staff-report',
            'stockton-mar-2026-staff-report'
          ]
        },
        {
          text: 'Grants are public money, not free vendor funding. They may carry legal restrictions and may leave workers and residents paying for later subscriptions, staffing, training, and replacement funds. Each expansion deepens the City’s dependence on a private platform that working people fund but do not own or govern.'
        }
      ]
    },
    {
      id: 'procurement',
      title: 'The City cited vendor continuity',
      summary:
        'City staff gave several reasons for continuing with Flock rather than opening the purchase to competition. The available records do not establish whether the competitive-bidding exception was lawful or unlawful.',
      paragraphs: [
        {
          text: 'Staff cited proprietary integration, continuity with existing Flock infrastructure, a limited market, and the risk of duplication or incompatibility. Their rationale shows how dependence on one vendor can make each new expansion appear easier than changing course.',
          sourceIds: ['stockton-nov-2024-staff-report', 'stockton-mar-2026-staff-report']
        }
      ]
    },
    {
      id: 'ownership',
      title: 'Who owns the hardware and operational data',
      summary:
        'Stockton is committing public money to a system whose vendor reserves control over the hardware and a broad category of operational and derived information.',
      paragraphs: [
        {
          text: 'The drone addendum says Flock owns the hardware and places stated risk of loss on the customer after delivery. It defines a broad category of “Flock Drone IP” that includes operational and derived information.',
          sourceIds: ['stockton-mar-2026-amendment']
        },
        {
          text: 'These terms do not establish that Stockton lost control of protected records. They do establish that public operations depend on Flock’s technology, permissions, and contract terms.',
          sourceIds: ['stockton-mar-2026-amendment']
        }
      ]
    },
    {
      id: 'sharing-and-audits',
      title: 'Sharing settings are not access history',
      summary:
        'Flock’s archived portal shows configured recipients and public search labels. Native City records are still needed to establish who actually searched, received, or disclosed Stockton data.',
      paragraphs: [
        {
          text: 'The August 8 portal archive listed 320 outbound-sharing recipients, including the Northern California Regional Intelligence Center (NCRIC), El Cajon Police Department, Stanford University CA PD, University of San Francisco CA PD, University of the Pacific (UOP), and “Decommissioned Org.” Immigration and Customs Enforcement (ICE), Customs and Border Protection (CBP), the Department of Homeland Security (DHS), and the United States Marshals Service (USMS) were not listed as direct recipients. A listed recipient is a sharing configuration, not proof of a search or disclosure.',
          sourceIds: ['stockton-portal-2026-08-08']
        },
        {
          text: 'The same 1,774-row public audit contained 40 rows labeled “USMS case,” and every public user ID was masked. USMS is a separate Department of Justice agency, not ICE. The label does not identify who requested the search, who had credentials, what information was returned, or whether the search was lawful.',
          sourceIds: ['stockton-portal-2026-08-08', 'usms-about']
        },
        {
          text: 'A City response to PRA 10325372 says a Stockton Police Department Flock administrator authorized UOP through the portal and that no written agreement was located. That response raises an audit and compliance question. It does not show that UOP searched or received Stockton data, and it does not establish a legal violation.',
          sourceIds: ['stockton-uop-pra', 'california-alpr-law', 'california-ag-alpr-guidance']
        },
        {
          text: 'NCRIC’s structure and generic data-sharing agreement create a possible indirect route for data. Stockton should release the records needed to audit that route. The public materials do not show that Stockton executed the agreement, contributed Flock data under it, or gave a federal or immigration agency access to Stockton records.',
          sourceIds: ['ncric-board', 'ncric-mou']
        }
      ]
    },
    {
      id: 'not-proven',
      title: 'What remains unverified',
      summary: 'Right now, we are not claiming any of the following:',
      points: [
        {
          text: 'Stockton shared data with ICE or any other federal immigration agency.'
        },
        { text: 'USMS directly accessed Stockton data or NCRIC gave ICE access.' },
        { text: 'UOP searched or received Stockton data.' },
        { text: 'Stockton violated state law or misused the system.' },
        {
          text: 'Every contracted camera, drone, radar unit, search tool, or video integration is deployed.'
        },
        {
          text: 'The reviewed materials provide a complete camera map, active hotlist list, sharing history, search log, or outside-agency access record.'
        },
        { text: 'The competitive-bidding exception was unlawful.' }
      ]
    },
    {
      id: 'open-questions',
      title: 'Records Stockton must release',
      summary: 'Stockton should answer the open questions by releasing:',
      points: [
        {
          text: 'The executed Amendment No. 3 and its procurement, invoice, purchase-order, and authorization records.'
        },
        {
          text: 'A current inventory and deployment status for cameras, drones, docks, radar, the trailer, Flock911, FreeForm, and video streams.'
        },
        {
          text: 'The owners, locations, feeds, retention rules, and permissions for the ten compatible video streams.'
        },
        {
          text: 'Current and historical sharing settings, stable recipient identifiers, administrator approvals, native search and access logs, outside requests, re-sharing records, and the identity of “Decommissioned Org.”'
        },
        {
          text: 'Native records for every “USMS case” row, including the local user, requester, case number, query scope, networks searched, results returned, authorization, and supervisory review.'
        },
        {
          text: 'Executed agreements, authorization records, legal reviews, and actual access records for UOP, NCRIC, El Cajon, university-associated entities, and every other outbound recipient.'
        },
        {
          text: 'Computer-aided dispatch fields, data flows, policies, integrations, funding records, and termination or deletion procedures.'
        }
      ],
      closingParagraphs: [
        {
          text: 'We are asking Stockton to publish these records so workers and residents can judge how public money and police power are being used, organize around what they learn, and decide together what safety systems the City should fund. Disclosure is an immediate demand. Lasting public control requires working people to keep investigating, deciding, and acting together after the records arrive.'
        }
      ]
    },
    {
      id: 'sources',
      title: 'Sources and notes',
      summary: 'Official city documents sit next to the claims they support, followed by a full source list.'
    }
  ],
  sources: stocktonSources
} as const satisfies CampaignPageContent
