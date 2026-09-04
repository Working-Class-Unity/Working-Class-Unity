import {
  campaignFacts as englishCampaignFacts,
  campaignFaqPage as englishCampaignFaqPage,
  campaignLandingPage as englishCampaignLandingPage,
  faqGroups as englishFaqGroups,
  petitionDemand as englishPetitionDemand,
  stocktonContractFacts as englishStocktonContractFacts,
  stocktonCostStack as englishStocktonCostStack,
  stocktonTimeline as englishStocktonTimeline,
  whatStocktonBoughtPage as englishWhatStocktonBoughtPage,
  whySafeguardsPage as englishWhySafeguardsPage
} from '~/content/remove-flock-stockton'
import type { CampaignFaqGroup } from '~/content/remove-flock-stockton'

const namespace = 'localizedRemoveFlock'

export function useRemoveFlockContent() {
  return {
    campaignFacts: useLocalizedContent(englishCampaignFacts, `${namespace}.campaignFacts`),
    campaignFaqPage: useLocalizedContent(englishCampaignFaqPage, `${namespace}.campaignFaqPage`),
    campaignLandingPage: useLocalizedContent(englishCampaignLandingPage, `${namespace}.campaignLandingPage`),
    faqGroups: useLocalizedContent<readonly CampaignFaqGroup[]>(englishFaqGroups, `${namespace}.faqGroups`),
    petitionDemand: useLocalizedContent(englishPetitionDemand, `${namespace}.petitionDemand`),
    stocktonContractFacts: useLocalizedContent(englishStocktonContractFacts, `${namespace}.stocktonContractFacts`),
    stocktonCostStack: useLocalizedContent(englishStocktonCostStack, `${namespace}.stocktonCostStack`),
    stocktonTimeline: useLocalizedContent(englishStocktonTimeline, `${namespace}.stocktonTimeline`),
    whatStocktonBoughtPage: useLocalizedContent(englishWhatStocktonBoughtPage, `${namespace}.whatStocktonBoughtPage`),
    whySafeguardsPage: useLocalizedContent(englishWhySafeguardsPage, `${namespace}.whySafeguardsPage`)
  }
}
