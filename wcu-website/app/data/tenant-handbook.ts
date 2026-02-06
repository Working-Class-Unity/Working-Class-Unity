export interface HandbookSectionMeta {
  id: string
  title: string
  summary: string
  keywords: string[]
}

export interface HandbookChapterMeta {
  id: string
  title: string
  summary: string
  goal: string
  evidenceChecklist: string[]
  commonMistakes: string[]
  escalateWhen: string
  sourceNotes: string[]
  lastReviewed: string
  sections: HandbookSectionMeta[]
}

export interface HandbookQuickPath {
  id: string
  title: string
  description: string
  targetId: string
  priority: 'urgent' | 'next' | 'learn'
}

export interface HandbookContactCard {
  id: string
  label: string
  phone: string
  email?: string
  note?: string
}

export const handbookQuickPaths: HandbookQuickPath[] = [
  {
    id: 'quick-eviction',
    title: 'I got a notice or court summons',
    description: 'Start with timelines, response deadlines, and what to document before court.',
    targetId: 'eviction-process',
    priority: 'urgent',
  },
  {
    id: 'quick-repairs',
    title: 'My unit has unsafe conditions',
    description: 'Use the repair workflow, evidence checklist, and agency contacts.',
    targetId: 'repairs',
    priority: 'next',
  },
  {
    id: 'quick-rent',
    title: 'My rent changed or I was threatened',
    description: 'Review protections, legal notice windows, and retaliation warning signs.',
    targetId: 'tenant-protections',
    priority: 'next',
  },
  {
    id: 'quick-file',
    title: 'I need to file a complaint',
    description: 'Go to filing tips before contacting code enforcement or county health.',
    targetId: 'filing-tips',
    priority: 'learn',
  },
]

export const handbookContacts: HandbookContactCard[] = [
  {
    id: 'contact-stockton-code',
    label: 'Stockton Code Enforcement',
    phone: '209-468-3141',
    email: 'NSS@Stocktonca.gov',
    note: 'Use for housing/building complaints and inspection follow-up.',
  },
  {
    id: 'contact-county-health',
    label: 'San Joaquin County Public Health Services',
    phone: '209-468-3400',
    email: 'phs-info@sjcphs.org',
    note: 'Use for health code violations like vermin, sewage, and visible mold.',
  },
  {
    id: 'contact-housing-authority',
    label: 'San Joaquin Fair Housing Authority',
    phone: '209-460-5000',
    note: 'Use for tenant assistance programs and housing discrimination support.',
  },
]

export const handbookChapters: HandbookChapterMeta[] = [
  {
    id: 'chapter-1',
    title: 'Chapter 1: Know Your Rights',
    summary: 'Use this chapter to confirm legal protections before negotiating with a landlord.',
    goal: 'Document conditions, assert legal notice rights, and avoid retaliation traps.',
    evidenceChecklist: [
      'Dated photos/videos of conditions',
      'Written repair requests and landlord replies',
      'Rent receipts, lease clauses, and notices',
    ],
    commonMistakes: [
      'Relying on verbal requests only',
      'Paying rent in cash without records',
      'Signing documents you have not reviewed',
    ],
    escalateWhen: 'Landlord ignores repairs, threatens move-out after complaints, or increases rent without proper notice.',
    sourceNotes: [
      'California Tenant Protection Act (AB 1482)',
      'Local rent increase limits for San Joaquin County',
      'California Civil Code repair and entry rules',
    ],
    lastReviewed: 'February 6, 2026',
    sections: [
      {
        id: 'tenant-protections',
        title: 'Tenant Protections & Rent Increases',
        summary: 'How rent caps, notice windows, and anti-retaliation rules protect occupied units.',
        keywords: ['rent increase', 'ab 1482', 'notice', 'retaliation', 'lease'],
      },
      {
        id: 'know-your-rights',
        title: 'Know Your Rights',
        summary: 'Habitability standards and rights every tenant keeps with or without stabilization.',
        keywords: ['habitability', 'safe unit', 'landlord duties', 'health', 'entry'],
      },
      {
        id: 'repairs',
        title: 'Repairs, Damage, or Infestation',
        summary: 'Step-by-step workflow to request repairs and preserve evidence.',
        keywords: ['repair request', 'certified mail', 'photos', 'inspection', 'infestation'],
      },
      {
        id: 'harassment',
        title: 'Harassment',
        summary: 'How to document harassment and build a record that can be used later.',
        keywords: ['harassment', 'documentation', 'witness', 'tenant union'],
      },
      {
        id: 'utilities',
        title: 'Utilities',
        summary: 'Who pays, what notice is required, and what utility shutoff behavior is illegal.',
        keywords: ['utilities', 'notice', 'billing', 'landlord responsibilities'],
      },
      {
        id: 'dos-donts',
        title: "Dos and Don'ts",
        summary: 'Practical behaviors that protect your legal position before, during, and after tenancy.',
        keywords: ['best practices', 'move-in', 'move-out', 'receipts'],
      },
    ],
  },
  {
    id: 'chapter-2',
    title: 'Chapter 2: Paying Rent',
    summary: 'This chapter helps you pay rent in ways that create proof and reduce legal risk.',
    goal: 'Protect payment evidence and follow notice instructions exactly.',
    evidenceChecklist: [
      'Money order or cashier check stubs',
      'Dated receipts showing amount and coverage period',
      'Mailing receipts with delivery confirmation',
    ],
    commonMistakes: [
      'Using regular mail without tracking',
      'Missing payment method instructions in notices',
      'Assuming late-fee terms create a legal grace period',
    ],
    escalateWhen: 'Landlord rejects compliant payment or claims nonpayment after documented delivery.',
    sourceNotes: [
      'California unlawful detainer notice rules',
      'Lease-specific payment method and due-date requirements',
    ],
    lastReviewed: 'February 6, 2026',
    sections: [
      {
        id: 'paying-rent',
        title: 'Easy Steps to Protect Yourself',
        summary: 'Payment methods, witnesses, and receipt rules that help prove payment.',
        keywords: ['rent', 'money order', 'receipt', 'mail proof', 'due date'],
      },
      {
        id: 'notice-to-pay',
        title: 'Notice to Pay Rent',
        summary: 'How to respond to a notice while preserving legal defenses and timing proof.',
        keywords: ['notice to pay', '3 day notice', 'delivery', 'witness', 'deadline'],
      },
    ],
  },
  {
    id: 'chapter-3',
    title: 'Chapter 3: Reporting Violations',
    summary: 'Use this chapter to report code issues with evidence that agencies can act on.',
    goal: 'File complaints in the right channel and follow up until closure.',
    evidenceChecklist: [
      'Case number and inspector contact card',
      'Photo/video set with dates and timestamps',
      'Copies of landlord and agency communications',
    ],
    commonMistakes: [
      'Filing vague complaints without visible evidence',
      'Assuming one complaint covers other units',
      'Stopping follow-up after the initial inspection',
    ],
    escalateWhen: 'Case is closed without repairs, or hazards continue after inspection deadlines.',
    sourceNotes: [
      'Stockton Neighborhood Services intake process',
      'San Joaquin County health reporting channels',
    ],
    lastReviewed: 'February 6, 2026',
    sections: [
      {
        id: 'code-enforcement',
        title: 'Stockton Code Enforcement',
        summary: 'Where and how to file city code complaints in Stockton.',
        keywords: ['stockton code enforcement', 'inspection', 'email', 'phone'],
      },
      {
        id: 'filing-tips',
        title: 'Tips for Filing Complaints',
        summary: 'Tactics that improve inspection quality and reduce case closure risk.',
        keywords: ['filing tips', 'case number', 'inspection report', 'follow up'],
      },
      {
        id: 'health-violations',
        title: 'Health Code Violations',
        summary: 'When to involve county health for vermin, mold, sewage, and sanitation.',
        keywords: ['health code', 'mold', 'rats', 'cockroaches', 'public health'],
      },
      {
        id: 'building-violations',
        title: 'Building Code Violations',
        summary: 'Structural or systems issues that should be sent to code enforcement.',
        keywords: ['building code', 'termites', 'roof', 'smoke detector'],
      },
    ],
  },
  {
    id: 'chapter-4',
    title: 'Chapter 4: Evictions',
    summary: 'Use this chapter to identify legal grounds, deadlines, and possible case outcomes.',
    goal: 'Respond quickly to notices, preserve defenses, and avoid avoidable displacement.',
    evidenceChecklist: [
      'All notices with service date and method',
      'Lease and payment records',
      'Repair/retaliation documentation if relevant',
    ],
    commonMistakes: [
      'Missing the court response deadline',
      'Signing voluntary move-out agreements without advice',
      'Withholding rent without legal consultation',
    ],
    escalateWhen: 'You receive a summons, writ, lockout threat, or relocation terms you do not understand.',
    sourceNotes: [
      'AB 1482 just-cause framework',
      'California unlawful detainer process and court timelines',
      'California Civil Code 1942.4 limits on rent demands',
    ],
    lastReviewed: 'February 6, 2026',
    sections: [
      {
        id: 'legal-reasons',
        title: 'Legal Reasons for Evictions',
        summary: 'What qualifies as just cause under current California protections.',
        keywords: ['legal reasons', 'just cause', 'ab 1482'],
      },
      {
        id: 'at-fault',
        title: 'At-Fault Evictions',
        summary: 'Acts or lease violations landlords can use for eviction claims.',
        keywords: ['at fault', 'lease breach', 'nuisance', 'entry denial'],
      },
      {
        id: 'no-fault',
        title: 'No-Fault Evictions',
        summary: 'No-fault grounds that generally require relocation compensation.',
        keywords: ['no fault', 'ellis act', 'relocation', 'owner move in'],
      },
      {
        id: 'no-rent-stabilization',
        title: 'If You DO NOT Live in Rent Stabilization',
        summary: 'Notice windows and 3-day triggers outside rent stabilization coverage.',
        keywords: ['60 day notice', '30 day notice', '3 day notice'],
      },
      {
        id: 'eviction-process',
        title: 'Eviction Process',
        summary: 'Timeline from notice to court outcomes and sheriff enforcement.',
        keywords: ['summons', 'trial', 'writ of possession', 'deadline'],
      },
      {
        id: 'voluntary-vacate',
        title: 'Voluntary Vacate Agreements',
        summary: 'Risks in cash-for-keys and why to seek advice before signing.',
        keywords: ['cash for keys', 'buyout', 'voluntary vacate'],
      },
      {
        id: 'estoppel',
        title: 'Estoppel Certificate',
        summary: 'How estoppel certificates can document terms during ownership changes.',
        keywords: ['estoppel', 'ownership change', 'occupancy terms'],
      },
    ],
  },
  {
    id: 'chapter-5',
    title: 'Chapter 5: Legal Entry & Security Deposit',
    summary: 'This chapter covers lawful entry limits and the timeline for deposit returns.',
    goal: 'Prevent unlawful entry and preserve your right to full deposit accounting.',
    evidenceChecklist: [
      'Entry notices with date/time/purpose',
      'Move-in and move-out photos',
      'Forwarding address and deposit correspondence',
    ],
    commonMistakes: [
      'Accepting multi-day 24-hour entry notices',
      'Failing to request or document move-out inspection',
      'Not providing mailing address for deposit return',
    ],
    escalateWhen: 'Landlord enters without proper notice or misses the 21-day deposit timeline.',
    sourceNotes: [
      'California Civil Code entry notice requirements',
      'California Civil Code 1950.5 security deposit rules',
    ],
    lastReviewed: 'February 6, 2026',
    sections: [
      {
        id: 'legal-entry',
        title: 'Legal Entry',
        summary: 'When notice is required, what counts as emergency entry, and buyer showing rules.',
        keywords: ['24 hour notice', 'entry', 'business hours', 'buyer showings'],
      },
      {
        id: 'security-deposits',
        title: 'Security Deposits',
        summary: 'Deposit limits, legal deductions, and 21-day return requirements.',
        keywords: ['security deposit', '21 days', 'deductions', 'refund'],
      },
    ],
  },
]

export const handbookChapterMap = Object.fromEntries(
  handbookChapters.map((chapter) => [chapter.id, chapter])
) as Record<string, HandbookChapterMeta>
