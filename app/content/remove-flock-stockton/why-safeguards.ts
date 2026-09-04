import { petitionDemand } from './petition'
import { safeguardsSources, stocktonSources } from './sources'
import type { CampaignPageContent } from './types'

export const whySafeguardsPage = {
  path: '/campaigns/remove-flock-stockton/why-safeguards-are-not-enough',
  eyebrow: 'WHY REMOVAL',
  title: 'Why Safeguards Are Not Enough',
  description:
    'Rules can reduce immediate harm. A ban on immigration-enforcement access would protect people now. It would not end routine collection or change who controls the records, police searches, vendor platform, or public money paying for it.',
  reviewedThrough: 'September 3, 2026',
  qualification:
    'We support firm interim protections. We are organizing for a different outcome: remove the system and put safety spending under public control. Working people should not have to accept routine tracking as the price of safe streets, useful public services, care, prevention, or accountable emergency response.',
  sections: [
    {
      id: 'ice-ban',
      title: 'An ICE ban would address one danger, not the system that creates it',
      summary:
        'A clear ban on U.S. Immigration and Customs Enforcement access would protect people now. We support that ban and other firm interim protections.',
      paragraphs: [
        {
          text: 'The ban would leave routine collection, police search power, drones, connected tools, vendor dependence, and public spending intact. Police would retain the ability to search records through a platform managed in part by a private company.'
        },
        {
          text: 'The larger question remains: should the city use public money to create searchable records of ordinary travel when residents are not suspected of wrongdoing?'
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
          text: "These records do not show that rules are useless. Rules can reduce harm, but they depend on software settings, access permissions, vendor conduct, audits, enforcement, and public verification. A protection on paper is only as strong as the public's ability to verify and enforce it."
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
          text: 'Every passing vehicle may enter the system, but the consequences are unequal. Immigrant families, workers organizing on the job, tenants facing retaliation, protesters, survivors, and people seeking sensitive healthcare face greater danger when police or other institutions with power over their lives can reach those records.'
        },
        {
          text: "This is not only a privacy question. It is a question of who controls public money, information, and police search power. Working people should not have to surrender freedom of movement in exchange for public safety. We can fight for safety through prevention, care, useful public services, and accountable emergency response without recording everyone's routine travel."
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
          text: 'Available local materials support an independent review, but they do not establish ICE access. An archived August 8 copy of Flock’s Stockton portal listed 320 outbound-sharing recipients and contained a 1,774-search audit whose public user IDs were all masked. Forty rows carried the stated reason “USMS case.”',
          sourceIds: ['stockton-portal-2026-08-08']
        },
        {
          text: 'A separate City response reported that an SPD Flock administrator authorized UOP through the portal and that no written agreement was located. Those materials justify an independent audit of original historical records covering access, authorization, and further sharing. An agency listed as a recipient and a search-reason label do not prove that ICE, or any other outside agency, accessed a Stockton record.',
          sourceIds: ['stockton-uop-pra']
        },
        {
          text: 'City records describe a contracted package that includes:'
        }
      ],
      closingParagraphs: [
        {
          text: 'Public money supports this platform. Police gain new tools and search power, and Flock manages parts of the technology, permissions, analysis, support, and subscriptions. Residents whose movements produce the records do not govern that relationship.'
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
          text: 'The drone agreement places parts of public operations inside Flock’s technology, permissions, and contract terms. Public money pays for the system, police gain search power, and a private vendor retains control over parts of the platform. That relationship weakens public control.',
          sourceIds: ['stockton-mar-2026-staff-report', 'stockton-mar-2026-amendment']
        },
        {
          text: 'Audit records may reveal less than readers expect. 404 Media reported that agencies were advised to be “as vague as permissible” when recording reasons for Flock searches.',
          sourceIds: ['404-vague-search-reasons']
        },
        {
          text: 'Immediate limits still matter. A strong search policy, an immigration-enforcement ban, deletion rules, and public audits can reduce harm during removal. They do not justify routine collection or transfer control to the working people whose movements become records and whose public money funds the system.'
        }
      ]
    },
    {
      id: 'removal',
      title: 'Removal is the durable safeguard',
      summary: 'Interim rules should reduce harm during removal. They should not become the final settlement.',
      paragraphs: [
        {
          text: 'The petition calls for an end to every Flock contract, a stop to expansion, lawful data deletion, a public closeout record, and a ban on recreating the same tracking function under another name.'
        },
        { text: petitionDemand.introduction }
      ],
      points: petitionDemand.demands.map((text) => ({ text })),
      orderedPoints: true,
      closingParagraphs: [
        {
          text: 'Removal is not a refusal of public safety. It is a demand that Stockton direct public money toward stable homes, safe work, care, prevention, useful public services, and accountable emergency response instead of routine tracking. Residents and workers can sign, talk with coworkers and neighbors, press the City Council, monitor compliance, and stay organized to govern the institutions and budgets meant to keep us safe.'
        }
      ]
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
