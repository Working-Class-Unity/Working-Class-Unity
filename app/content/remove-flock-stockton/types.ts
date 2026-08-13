export type CampaignSource = Readonly<{
  id: string
  title: string
  publisher: string
  sourceType?:
    | 'Stockton record'
    | 'Archived Flock portal'
    | 'Third-party analysis'
    | 'Official legal/policy source'
    | 'Press report'
    | 'Records requested'
    | 'WCU analysis'
  published?: string
  reviewed?: string
  url: string
  note?: string
}>

export type CitedText = Readonly<{
  text: string
  sourceIds?: readonly string[]
}>

export type CampaignSection = Readonly<{
  id: string
  title: string
  summary: string
  paragraphs?: readonly CitedText[]
  points?: readonly CitedText[]
}>

export type CampaignPageContent = Readonly<{
  path: string
  eyebrow: string
  title: string
  description: string
  reviewedThrough?: string
  qualification?: string
  sections: readonly CampaignSection[]
  sources: readonly CampaignSource[]
}>

export type CampaignFact = Readonly<{
  value: string
  label: string
  detail: string
  sourceIds: readonly string[]
}>

export type CampaignTimelineEntry = Readonly<{
  date: string
  action: string
  description: string
  sourceIds: readonly string[]
  status?: 'verified' | 'reported-with-gap'
}>

export type CampaignFaqItem = Readonly<{
  id: string
  question: string
  answer: readonly CitedText[]
  points?: readonly CitedText[]
}>

export type CampaignFaqGroup = Readonly<{
  id: string
  title: string
  summary: string
  items: readonly CampaignFaqItem[]
}>
