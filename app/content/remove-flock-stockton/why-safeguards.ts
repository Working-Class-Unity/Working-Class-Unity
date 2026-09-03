import { petitionDemand } from './petition'
import { safeguardsSources, stocktonSources } from './sources'
import type { CampaignPageContent } from './types'

export const whySafeguardsPage = {
  path: '/campaigns/remove-flock-stockton/why-safeguards-are-not-enough',
  eyebrow: 'Why Safeguards Are Not Enough',
  title: 'Removal, not Reform',
  description:
    'Rules can reduce immediate harm. They cannot solve the basic problem of recording everyone first and deciding later how that information may be used.',
  reviewedThrough: 'August 12, 2026',
  qualification:
    'Working Class Unity supports firm interim protections, including a ban on immigration-enforcement access. Interim protection is not the same as dismantling the system.',
  sections: [
    {
      id: 'ice-ban',
      title: 'An ICE ban would address one danger—not the system that creates it',
      summary:
        'A clear prohibition would protect people now. It would leave routine collection, police searches, drones, connected tools, and vendor dependence intact.',
      paragraphs: [
        {
          text: 'A rule barring immigration-enforcement use of Stockton’s Flock data would be a meaningful immediate protection, and Working Class Unity would support it.'
        },
        {
          text: 'The larger question remains: should the city create searchable records of ordinary travel when residents are not suspected of wrongdoing?'
        }
      ]
    },
    {
      id: 'california-warnings',
      title: 'California cities already had safeguards',
      summary: 'Written policy and actual platform access did not always match.',
      paragraphs: [
        {
          text: 'Mountain View terminated its Flock contract after a city audit found federal and state access that violated city policy. The city had already turned off its cameras.',
          sourceIds: ['mountain-view-termination', 'mountain-view-council-report']
        },
        {
          text: 'Oxnard suspended its cameras after an audit found that a vendor-enabled nationwide query let outside and federal agencies include Oxnard data in searches without city approval.',
          sourceIds: ['oxnard-suspension']
        },
        {
          text: 'Los Altos reported that a statewide lookup setting had been active without city approval. The city said this conflicted with policy and asked Flock to turn it off.',
          sourceIds: ['los-altos-community-message']
        },
        {
          text: 'These records do not show that rules are useless. They show that rules depend on software settings, access permissions, vendor conduct, audits, enforcement, and public verification.'
        }
      ]
    },
    {
      id: 'collection',
      title: 'The collection itself creates the danger',
      summary: 'A vehicle-location record is a record of human movement.',
      paragraphs: [
        {
          text: 'Automated license-plate readers record plates, vehicle details, time, and location, then turn those observations into searchable records. Collection comes first. A judgment about relevance comes later.'
        },
        {
          text: 'California’s Attorney General has warned that plate data can reveal patterns tied to homes, workplaces, schools, medical care, places of worship, and daily movement.',
          sourceIds: ['california-ag-el-cajon']
        },
        {
          text: 'Every passing vehicle may enter the system, but the consequences are unequal. Immigrant families, workers organizing on the job, tenants facing retaliation, protesters, survivors, and people seeking sensitive healthcare face greater danger from exposure to institutions with power over their lives.'
        },
        {
          text: 'Working people should not have to surrender freedom of movement in exchange for public safety.'
        }
      ]
    },
    {
      id: 'stockton-platform',
      title: 'Stockton approved an expanding surveillance platform',
      summary:
        'City records describe connected cameras, searchable records, emergency-response tools, drones, video, vendor integrations, and years of public spending.',
      points: [
        { text: 'License-plate cameras and searchable vehicle-location data.' },
        { text: 'Software tied to emergency calls and dispatch.' },
        { text: 'Six contracted drones and docks, radar, and video feeds.' },
        { text: 'Vendor-managed software, permissions, analysis, support, and subscriptions.' },
        {
          text: 'A stated contract maximum above $5.4 million through April 14, 2031.',
          sourceIds: ['stockton-mar-2026-staff-report', 'stockton-mar-2026-amendment']
        }
      ],
      paragraphs: [
        {
          text: 'The March 2026 records place the new Drone as First Responder package at $3.15 million.',
          sourceIds: ['stockton-mar-2026-staff-report', 'stockton-mar-2026-amendment']
        },
        {
          text: 'Available local materials reinforce the need for independent verification without establishing ICE access. An archived August 8 copy of Flock’s Stockton portal listed 320 outbound-sharing recipients and contained a 1,774-search audit whose public user IDs were all masked; 40 rows carried the stated reason “USMS case.”',
          sourceIds: ['stockton-portal-2026-08-08']
        },
        {
          text: 'A separate City response reported that an SPD Flock administrator authorized UOP through the portal and that no written agreement was located. Those materials justify a native historical audit of access, authorization, and re-sharing. A configured recipient and a search-reason label do not prove that ICE—or any other outside agency—accessed a Stockton record.',
          sourceIds: ['stockton-uop-pra']
        }
      ]
    },
    {
      id: 'limited-use',
      title: 'Limited-use promises do not justify recording everyone',
      summary: 'A narrow search policy cannot turn broad collection into a targeted investigation.',
      paragraphs: [
        {
          text: 'A system does not need a name-search field to expose where a person lives, works, worships, receives care, or meets other people. Repeated vehicle records can reveal patterns about a person’s life.'
        },
        {
          text: 'Targeted investigations should be targeted. Stockton should not build a standing pool of movement records for later police searches.'
        },
        {
          text: 'The drone agreement places parts of public operations inside Flock’s technology, permissions, and contract terms. That relationship weakens public control.',
          sourceIds: ['stockton-mar-2026-staff-report', 'stockton-mar-2026-amendment']
        },
        {
          text: 'Audit records may reveal less than readers expect. 404 Media reported that agencies were advised to be “as vague as permissible” when recording reasons for Flock searches.',
          sourceIds: ['404-vague-search-reasons']
        }
      ]
    },
    {
      id: 'removal',
      title: 'Removal is the durable safeguard',
      summary: 'Interim rules should reduce harm during removal. They should not become the final settlement.',
      paragraphs: [
        {
          text: 'The petition demand appears here without editorial changes. It calls for an end to every Flock contract, a stop to expansion, lawful data deletion, a public closeout record, and a ban on recreating the same tracking function under another name.'
        },
        { text: petitionDemand.introduction }
      ],
      points: petitionDemand.demands.map((text) => ({ text }))
    },
    {
      id: 'sources',
      title: 'Sources',
      summary:
        'City records, California public-agency notices, and reviewed reporting sit next to the claims they support.'
    }
  ],
  sources: [...safeguardsSources, ...stocktonSources]
} as const satisfies CampaignPageContent
