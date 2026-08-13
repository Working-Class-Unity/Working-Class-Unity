import { petitionDemand } from './petition'
import { faqSources, safeguardsSources, stocktonSources } from './sources'
import type { CampaignFaqGroup, CampaignPageContent } from './types'

export const faqGroups = [
  {
    id: 'basics',
    title: 'The system and the demand',
    summary: 'What Flock sells, what Stockton authorized, and why Working Class Unity calls for removal.',
    items: [
      {
        id: 'what-is-flock',
        question: 'What is Flock?',
        answer: [
          {
            text: 'Flock Safety sells surveillance cameras and software to police departments, businesses, schools, neighborhoods, and homeowners associations. Its automated license-plate readers turn plates, vehicle details, time, and location into searchable records.',
            sourceIds: ['flock-products', 'flock-license-plate-readers']
          },
          {
            text: 'The company sells drones, video cameras, audio detection, mobile trailers, 911 tools, and software that joins information from different systems. Flock is selling an expanding platform, not one stand-alone camera.',
            sourceIds: ['flock-products', 'flock-os']
          }
        ]
      },
      {
        id: 'what-stockton-approved',
        question: 'What did Stockton approve?',
        answer: [
          {
            text: 'Stockton records describe an original 15-camera contract and a later 105-camera expansion. In March 2026, council approved a Drone as First Responder package with six docked drones, radar, Flock911, a mobile trailer, FreeForm search, and ten compatible video streams.',
            sourceIds: ['stockton-nov-2024-staff-report', 'stockton-nov-2024-amendment', 'stockton-mar-2026-amendment']
          },
          {
            text: 'The amendment added $3.15 million and extended the agreement through April 14, 2031. City records state a potential total above $5.4 million.',
            sourceIds: ['stockton-mar-2026-staff-report', 'stockton-mar-2026-amendment']
          },
          {
            text: 'These records establish what the city authorized or contracted for. They do not establish that every product has been deployed.'
          }
        ]
      },
      {
        id: 'why-removal',
        question: 'Why is WCU calling for removal?',
        answer: [
          {
            text: 'Flock begins by recording ordinary movement. Police can search those records later. That approach gives police and a corporate vendor more power to observe the public without giving residents greater control over the conditions that make them unsafe.'
          },
          {
            text: 'Working Class Unity calls for an end to the contracts, a stop to expansion, lawful data deletion, a public closeout record, and a ban on recreating the same mass-tracking function under another company name.'
          }
        ]
      }
    ]
  },
  {
    id: 'safety',
    title: 'Safety and police claims',
    summary:
      'The campaign takes violence and theft seriously without accepting routine movement tracking as the answer.',
    items: [
      {
        id: 'public-safety',
        question: 'Does WCU take public safety seriously?',
        answer: [
          {
            text: 'Yes. People deserve to live without car theft, violence, dangerous streets, slow emergency response, or fear in their neighborhoods.'
          },
          {
            text: 'Safety reaches beyond policing. It includes stable housing, safe work, dependable emergency and crisis response, youth programs, parks and libraries, protection from violence, safe streets, care, and the freedom to ask for support without exposing a family to needless police or immigration scrutiny.'
          },
          {
            text: 'Flock’s answer is more cameras, searches, data, and police technology. WCU starts from public investment, public accountability, and working people gaining real power over the institutions responsible for safety.'
          }
        ]
      },
      {
        id: 'stolen-cars',
        question: 'What about stolen cars and serious crimes?',
        answer: [
          {
            text: 'Stolen cars and serious crimes are real harms. They deserve serious responses. Flock markets plate readers as tools for wanted vehicles, stolen-property recovery, and investigative leads.',
            sourceIds: ['flock-license-plate-readers']
          },
          {
            text: 'Those needs do not give the city a blank check to collect and search everyone’s movement data. Targeted investigations should be targeted.'
          }
        ]
      },
      {
        id: 'solve-crimes',
        question: 'Does Flock solve crimes?',
        answer: [
          {
            text: 'Flock and police departments say the system has produced vehicle recoveries, leads, missing-person locations, and faster responses. WCU does not need to deny every case story.',
            sourceIds: ['flock-license-plate-readers']
          },
          {
            text: 'A technology may contribute to one investigation and still create a form of institutional power Stockton should reject. A case story does not decide how much data should be collected, who may search it, how the system may expand, or what public capacity loses funding and attention.'
          }
        ]
      },
      {
        id: 'performance-metrics',
        question: 'Why not judge Flock by arrests, recoveries, or response times?',
        answer: [
          {
            text: 'Those figures describe police activity. They do not count how many people enter the database with no connection to a crime, how broadly records may be searched, what new uses may appear, or what long-term dependence the contract creates.'
          },
          {
            text: 'Enforcement measures do not, on their own, prove lasting public safety or justify routine tracking.'
          }
        ]
      }
    ]
  },
  {
    id: 'power-and-risk',
    title: 'Power, movement, and unequal risk',
    summary:
      'Broad collection lands inside unequal relations among police, immigration authorities, employers, landlords, and residents.',
    items: [
      {
        id: 'just-a-tool',
        question: 'Is Flock just a tool?',
        answer: [
          {
            text: 'No. Flock describes a platform that connects plate readers, video, drones, audio detection, 911 calls, dispatch, records systems, public and private cameras, and agency sharing.',
            sourceIds: ['flock-os']
          },
          {
            text: 'Infrastructure changes what an institution can do as a routine matter. Once a connected system exists, new cameras, agencies, databases, and search functions can be added over time.'
          }
        ]
      },
      {
        id: 'equal-effects',
        question: 'Does Flock affect everyone equally?',
        answer: [
          {
            text: 'Everyone passing a camera may be recorded. Everyone does not face the same consequences.'
          },
          {
            text: 'Movement records carry greater danger for immigrant families, workers organizing on the job, tenants meeting about landlord conditions, people at protests, people seeking sensitive healthcare, survivors protecting their location, people under supervision, and residents already facing concentrated police attention.'
          },
          {
            text: 'Mass collection may be indiscriminate. Its consequences are not.'
          }
        ]
      },
      {
        id: 'nothing-to-hide',
        question: 'Should only people breaking the law worry?',
        answer: [
          {
            text: 'No. Plate readers record ordinary travel. They do not know whether someone is going to work, school, medical care, a tenant meeting, a union meeting, a protest, an attorney, a family member, or a place of worship.'
          },
          {
            text: 'Flock says its plate-reader system does not use facial recognition. A system does not need facial recognition to reveal repeated travel, stops, and nearby vehicles.',
            sourceIds: ['flock-license-plate-readers']
          },
          {
            text: 'The question is not whether a person has something to hide. The question is whether Stockton should normalize recording movement without individualized suspicion.'
          }
        ]
      },
      {
        id: 'collected-data',
        question: 'What data does Flock collect?',
        answer: [
          {
            text: 'Flock says its plate readers can collect plate characters, vehicle images, time, location, make, model, color, and other visible vehicle traits.',
            sourceIds: ['flock-license-plate-readers']
          },
          {
            text: 'Search tools can use a plate or partial vehicle description. Flock describes FreeForm as a natural-language search across compatible plate images and video evidence.',
            sourceIds: ['flock-freeform']
          },
          {
            text: 'The system does more than take photographs. It organizes them into records that can be searched, compared, shared, and joined to other information.'
          }
        ]
      }
    ]
  },
  {
    id: 'immigration-and-controls',
    title: 'Immigration enforcement and safeguards',
    summary: 'Immediate restrictions matter. They do not remove the collection system or its police and vendor power.',
    items: [
      {
        id: 'ice-sharing',
        question: 'Does Stockton share Flock data with ICE or federal agencies?',
        answer: [
          {
            text: 'WCU is not claiming that Stockton has shared Flock data with ICE.'
          },
          {
            text: 'Deputy Chief Kyle Pierce said, “We have not shared any information related to immigration with our federal partners.” That statement concerns immigration-related information; it is not a claim that Stockton has never cooperated with any federal agency for another purpose.',
            sourceIds: ['stocktonia-apr-2026']
          },
          {
            text: 'An archived August 8 portal snapshot listed 320 outbound-sharing recipients, including NCRIC, El Cajon Police Department, Stanford University CA PD, University of San Francisco CA PD, University of the Pacific, and “Decommissioned Org.” ICE, CBP, DHS, and USMS were not listed as direct recipients. A listed recipient is a sharing configuration, not proof of an actual search or disclosure.',
            sourceIds: ['stockton-portal-2026-08-08']
          },
          {
            text: 'The same 1,774-row public audit contained 40 rows labeled “USMS case,” and every public user ID was masked. USMS is a separate Department of Justice agency, not ICE. The label does not identify who requested the search, whether USMS had credentials, what information was returned, or whether the search was lawful.',
            sourceIds: ['stockton-portal-2026-08-08', 'usms-about']
          },
          {
            text: 'A City response to PRA 10325372 says an SPD Flock administrator authorized UOP through the portal and that no written agreement was located. This raises an audit and compliance question, but it does not prove UOP accessed data.',
            sourceIds: ['stockton-uop-pra']
          },
          {
            text: 'NCRIC’s structure creates a possible indirect-sharing pathway worth auditing. The public material does not prove that a federal or immigration agency used that pathway to access Stockton data.',
            sourceIds: ['ncric-board', 'ncric-mou']
          }
        ]
      },
      {
        id: 'ice-ban',
        question: 'Would an ICE ban help?',
        answer: [
          {
            text: 'Yes. A clear, enforceable prohibition on immigration-enforcement use would address an urgent danger. WCU would support that protection during the removal process.'
          },
          {
            text: 'An ICE restriction would not stop routine collection, other police searches, drones, vendor dependence, future policy changes, agency intermediaries, or expansion into more surveillance functions.'
          },
          {
            text: 'It is an immediate protection, not a substitute for dismantling the system.'
          }
        ]
      },
      {
        id: 'safeguards',
        question: 'What about Flock’s safeguards?',
        answer: [
          {
            text: 'Flock points to audit logs, access controls, search histories, retention settings, sharing permissions, and public dashboards. Proper configuration and enforcement may reduce some forms of misuse.',
            sourceIds: ['flock-dfr']
          },
          {
            text: 'A shorter retention period still starts with collection. An audit log records a search after it happens. A dashboard describes a surveillance system that remains in operation.'
          },
          {
            text: 'Settings are not democratic control, and oversight is not removal.'
          }
        ]
      }
    ]
  },
  {
    id: 'private-platform',
    title: 'A private platform inside public policing',
    summary:
      'Public money, police power, vendor revenue, grants, drones, and private cameras form one political relationship.',
    items: [
      {
        id: 'private-company',
        question: 'Why does it matter that Flock is a private company?',
        answer: [
          {
            text: 'Flock supplies software, cloud services, integrations, maintenance, access controls, updates, and recurring subscriptions that become part of police operations.'
          },
          {
            text: 'The public supplies the money. Residents supply data through ordinary movement. Police gain surveillance capacity. The company receives recurring revenue as the platform expands.'
          },
          {
            text: 'The American Civil Liberties Union warned that changes to Flock’s standard terms appeared to give the company greater control over access to customer data and broader continuing rights to use information.',
            sourceIds: ['aclu-flock-terms']
          },
          {
            text: 'Public-safety infrastructure should answer to the public, not to a company whose business grows through wider surveillance.'
          }
        ]
      },
      {
        id: 'drones-and-readers',
        question: 'Are drones different from license-plate readers?',
        answer: [
          {
            text: 'They collect different information, but Stockton contracted to place them in the same platform. Flock says docked police drones can respond to calls or alerts, stream live video, and connect with 911, dispatch, plate-reader, and other systems.',
            sourceIds: ['flock-dfr', 'stockton-mar-2026-amendment']
          },
          {
            text: 'Plate readers create searchable records of vehicle movement. Drones add live aerial observation of people, homes, streets, yards, and gatherings.'
          }
        ]
      },
      {
        id: 'all-drones',
        question: 'Are drones always bad?',
        answer: [
          {
            text: 'Not every drone use presents the same issue. A city may debate narrow fire, disaster, or search-and-rescue uses under separate operators and data rules.'
          },
          {
            text: 'Stockton’s package concerns docked police drones tied to a private platform that connects plate readers, video, 911 information, and search software. The campaign opposes that standing police-surveillance infrastructure.'
          }
        ]
      },
      {
        id: 'businesses-neighborhoods',
        question: 'What about businesses and neighborhoods that want more safety?',
        answer: [
          {
            text: 'People are right to want safer stores, parking lots, apartment buildings, jobs, and neighborhoods.'
          },
          {
            text: 'Flock markets systems to businesses, schools, neighborhoods, homeowners associations, and police. Its platform can connect public and private data sources.',
            sourceIds: ['flock-os']
          },
          {
            text: 'Renters, workers, visitors, and people passing through may be recorded with no voice in the purchase. Safety should be a public commitment, not a product distributed through property ownership and purchasing power.'
          }
        ]
      },
      {
        id: 'grant-funding',
        question: 'What if a grant pays for it?',
        answer: [
          {
            text: 'Grant money is public money. Stockton records identify grants and police funds for parts of the Flock system. They leave later costs and appropriations open.',
            sourceIds: [
              'stockton-jul-2024-staff-report',
              'stockton-nov-2024-grant-report',
              'stockton-nov-2024-grant-award',
              'stockton-mar-2026-staff-report'
            ]
          },
          {
            text: 'A grant may cover early costs and still create subscriptions, training duties, proprietary dependence, pressure for replacement funds, and resistance to dismantling the system.'
          },
          {
            text: 'Some grant funds may be restricted. WCU will not promise that every Flock dollar can move directly to another program. Stockton should publish every funding condition and reject grants that require an unacceptable surveillance system.'
          }
        ]
      }
    ]
  },
  {
    id: 'removal-and-action',
    title: 'Removal, public records, and organized action',
    summary:
      'Changing a rule or vendor is not the goal. The system must come down, and residents must be able to verify the result.',
    items: [
      {
        id: 'stronger-rules',
        question: 'Why not keep Flock with stronger rules?',
        answer: [
          {
            text: 'Stronger rules can reduce harm. They leave ordinary travel records, police searches, connected cameras and drones, a private platform, and infrastructure that later officials may expand.'
          },
          {
            text: 'The American Civil Liberties Union has published a model resolution for full contract cancellation. Rules and removal serve different goals.',
            sourceIds: ['aclu-cancellation-resolution']
          },
          {
            text: 'WCU supports immediate protections during removal. We do not accept a regulated version of routine mass tracking as the final answer.'
          }
        ]
      },
      {
        id: 'switch-vendors',
        question: 'Why not switch vendors?',
        answer: [
          {
            text: 'Changing the company name does not change the function. A replacement that records vehicle locations, makes them searchable, and connects them to police systems recreates the same power.'
          },
          {
            text: 'The demand targets mass tracking, regardless of vendor, brand, or funding source.'
          }
        ]
      },
      {
        id: 'public-records',
        question: 'What records should Stockton release?',
        answer: [
          {
            text: 'Stockton should release the records needed to establish what was bought, who could use it, how it was configured, what access occurred, and whether shutdown and deletion are complete.'
          },
          {
            text: 'Public release should protect individual plate numbers and travel records. Redaction can preserve that privacy and still show search volume, agencies, stated purposes, sharing, and system operation.',
            sourceIds: ['aclu-alpr-public-data']
          },
          {
            text: 'Public records let residents learn what was built and verify that removal occurred.'
          }
        ],
        points: [
          { text: 'Every Flock contract, amendment, quote, incorporated term, grant record, and permitted use.' },
          {
            text: 'A complete inventory of cameras, drones, software, sensors, integrations, deployment status, and equipment locations, subject only to narrowly justified legal redactions.'
          },
          {
            text: 'Data-retention and deletion rules, search and audit policies, training materials, operating procedures, and lists of authorized agencies and users.'
          },
          {
            text: 'Active and historical sharing settings, stable recipient identifiers, add and remove dates, administrator approvals, and stated purposes.'
          },
          {
            text: 'Appropriately redacted native search and access logs showing the local user, organization, requester, case number, query scope, records returned, and disclosures made.'
          },
          { text: 'Outside-agency requests and records of searches performed on their behalf.' },
          {
            text: 'Executed agreements, administrator-authorization records, legal reviews, and actual access records for UOP, NCRIC, El Cajon, university-associated entities, and every other outbound recipient.'
          },
          {
            text: 'The identity and sharing history of “Decommissioned Org,” plus onward-sharing and re-sharing records for external recipients.'
          },
          {
            text: 'Native records underlying every “USMS case” row, including whether USMS requested the search or had direct credentials.'
          },
          {
            text: 'Native fields underlying blank public reasons and masked user IDs, plus the City’s redaction and publication rules.'
          },
          {
            text: 'Private-camera or data agreements and vendor communications about settings, access, compliance, and system changes.'
          },
          {
            text: 'Complaints, misuse investigations, security incidents, corrective actions, public dashboards, and internal audits.'
          },
          {
            text: 'Termination clauses, shutdown costs, removal procedures, and the process through which Flock and third parties will delete Stockton data.'
          }
        ]
      },
      {
        id: 'meaning-of-removal',
        question: 'What does removal mean?',
        answer: [
          {
            text: 'The petition language sets the campaign’s exact demand. It is reproduced without editorial changes.'
          }
        ],
        points: petitionDemand.demands.map((text) => ({ text }))
      },
      {
        id: 'fund-instead',
        question: 'What should Stockton fund instead?',
        answer: [
          {
            text: 'Stockton should build safety residents can use, shape, and hold accountable: stable housing, youth jobs and recreation, parks and libraries, violence prevention, crisis care, survivor services, lighting, sidewalks, treatment, neighborhood infrastructure, emergency readiness, and dependable public workers.'
          },
          {
            text: 'Funding rules may restrict some dollars. The city can disclose those limits, reject harmful grants, and stop committing future city resources to private surveillance.'
          },
          {
            text: 'Public safety should grow through public investment and democratic control, not permanent dependence on private surveillance contracts.'
          }
        ]
      },
      {
        id: 'resident-action',
        question: 'How can residents take part?',
        answer: [
          {
            text: 'Residents can sign and share the removal demand, speak or write to council, review records, talk with neighbors and coworkers, canvass, invite organizations into the campaign, attend meetings, and take responsibility for research, outreach, translation, or follow-up.'
          },
          {
            text: 'A petition signature or council appearance starts the work. It does not end it.'
          },
          {
            text: 'The goal is an organized public that can investigate what the city built, decide what safety should mean, win removal, and verify that the decision was carried out.'
          }
        ]
      }
    ]
  }
] as const satisfies readonly CampaignFaqGroup[]

export const campaignFaqPage = {
  path: '/campaigns/remove-flock-stockton/faq',
  eyebrow: 'QUESTIONS AND ANSWERS',
  title: 'Stockton Flock FAQ',
  description:
    'Direct answers about public safety, movement data, immigration enforcement, private police technology, public spending, and what removal requires.',
  reviewedThrough: 'August 12, 2026',
  qualification:
    'This page does not claim that Stockton shared Flock data with ICE, broke state law, or deployed every contracted product. It separates Stockton records from vendor claims and examples from other cities.',
  sections: faqGroups.map((group) => ({
    id: group.id,
    title: group.title,
    summary: group.summary
  })),
  sources: [...stocktonSources, ...safeguardsSources, ...faqSources]
} as const satisfies CampaignPageContent
