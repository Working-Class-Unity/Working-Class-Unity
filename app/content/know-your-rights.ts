export const knowYourRightsBasePath = '/campaigns/know-your-rights'

export const knowYourRightsGuides = [
  {
    slug: 'ice-in-public',
    path: knowYourRightsBasePath + '/ice-in-public',
    titleKey: 'kyr.public.title',
    descriptionKey: 'kyr.public.description'
  },
  {
    slug: 'ice-pulls-you-over',
    path: knowYourRightsBasePath + '/ice-pulls-you-over',
    titleKey: 'kyr.car.title',
    descriptionKey: 'kyr.car.description'
  },
  {
    slug: 'ice-at-home',
    path: knowYourRightsBasePath + '/ice-at-home',
    titleKey: 'kyr.home.title',
    descriptionKey: 'kyr.home.description'
  },
  {
    slug: 'ice-at-work',
    path: knowYourRightsBasePath + '/ice-at-work',
    titleKey: 'kyr.work.title',
    descriptionKey: 'kyr.work.description'
  },
  {
    slug: 'documents-to-keep',
    path: knowYourRightsBasePath + '/documents-to-keep',
    titleKey: 'kyr.documents.title',
    descriptionKey: 'kyr.documents.description'
  }
] as const

export type KnowYourRightsGuideSlug = (typeof knowYourRightsGuides)[number]['slug']
