import type { CampaignSource } from './types'

export const stocktonSources = [
  {
    id: 'stockton-jul-2024-minutes',
    title: 'Stockton City Council minutes, July 9, 2024',
    publisher: 'City of Stockton',
    published: 'July 9, 2024',
    reviewed: 'May 3, 2026',
    url: 'https://stockton.granicus.com/MinutesViewer.php?clip_id=8721&view_id=48'
  },
  {
    id: 'stockton-jul-2024-staff-report',
    title: 'File 24-0561 legislation text',
    publisher: 'City of Stockton',
    published: 'July 9, 2024',
    reviewed: 'May 3, 2026',
    url: 'https://stockton.granicus.com/MetaViewer.php?view_id=48&clip_id=8721&meta_id=774251'
  },
  {
    id: 'stockton-jul-2024-amendment',
    title: 'Flock Amendment No. 1',
    publisher: 'City of Stockton',
    published: 'July 9, 2024',
    reviewed: 'May 3, 2026',
    url: 'https://stockton.granicus.com/MetaViewer.php?view_id=48&clip_id=8721&meta_id=774252'
  },
  {
    id: 'stockton-nov-2024-grant-minutes',
    title: 'Stockton City Council minutes, November 12, 2024',
    publisher: 'City of Stockton',
    published: 'November 12, 2024',
    reviewed: 'May 3, 2026',
    url: 'https://stockton.granicus.com/MinutesViewer.php?view_id=48&clip_id=8857'
  },
  {
    id: 'stockton-nov-2024-grant-report',
    title: 'File 24-1067 legislation text',
    publisher: 'City of Stockton',
    published: 'November 12, 2024',
    reviewed: 'May 3, 2026',
    url: 'https://stockton.granicus.com/MetaViewer.php?view_id=48&clip_id=8857&meta_id=786685'
  },
  {
    id: 'stockton-nov-2024-grant-award',
    title: 'COPS Technology and Equipment Program award package',
    publisher: 'City of Stockton',
    published: 'November 12, 2024',
    reviewed: 'May 3, 2026',
    url: 'https://stockton.granicus.com/MetaViewer.php?view_id=48&clip_id=8857&meta_id=786687'
  },
  {
    id: 'stockton-nov-2024-grant-resolution',
    title: 'Resolution 2024-11-12-1210',
    publisher: 'City of Stockton',
    published: 'November 12, 2024',
    reviewed: 'May 3, 2026',
    url: 'https://stockton.granicus.com/MetaViewer.php?view_id=48&clip_id=8857&meta_id=787254'
  },
  {
    id: 'stockton-nov-2024-minutes',
    title: 'Stockton City Council minutes, November 19, 2024',
    publisher: 'City of Stockton',
    published: 'November 19, 2024',
    reviewed: 'May 3, 2026',
    url: 'https://stockton.granicus.com/MinutesViewer.php?view_id=48&clip_id=8863'
  },
  {
    id: 'stockton-nov-2024-staff-report',
    title: 'File 24-1097 legislation text',
    publisher: 'City of Stockton',
    published: 'November 19, 2024',
    reviewed: 'May 3, 2026',
    url: 'https://stockton.granicus.com/MetaViewer.php?view_id=48&clip_id=8863&meta_id=788113'
  },
  {
    id: 'stockton-nov-2024-amendment',
    title: 'Flock Amendment No. 2',
    publisher: 'City of Stockton',
    published: 'November 19, 2024',
    reviewed: 'May 3, 2026',
    url: 'https://stockton.granicus.com/MetaViewer.php?view_id=48&clip_id=8863&meta_id=788114'
  },
  {
    id: 'stockton-mar-2026-agenda',
    title: 'Stockton City Council agenda and draft minutes, March 31, 2026',
    publisher: 'City of Stockton',
    published: 'March 31, 2026',
    reviewed: 'May 3, 2026',
    url: 'https://stockton.granicus.com/AgendaViewer.php?view_id=48&clip_id=9431'
  },
  {
    id: 'stockton-mar-2026-staff-report',
    title: 'File 26-0269 staff report',
    publisher: 'City of Stockton',
    published: 'March 31, 2026',
    reviewed: 'May 3, 2026',
    url: 'https://stockton.granicus.com/MetaViewer.php?view_id=48&event_id=3013&meta_id=842708'
  },
  {
    id: 'stockton-mar-2026-amendment',
    title: 'File 26-0269 Amendment A—Agreement and Quote',
    publisher: 'City of Stockton',
    published: 'March 31, 2026',
    reviewed: 'May 3, 2026',
    url: 'https://stockton.granicus.com/MetaViewer.php?view_id=48&event_id=3013&meta_id=842709'
  },
  {
    id: 'stockton-ceqa-2025',
    title: 'Stockton Police Department Flock ALPR Camera Installation Project',
    publisher: 'California CEQAnet',
    published: 'March 19, 2025',
    reviewed: 'May 3, 2026',
    url: 'https://ceqanet.lci.ca.gov/2025030783'
  },
  {
    id: 'stocktonia-apr-2026',
    title: 'Stockton approves $3.15M police drone program despite public opposition',
    publisher: 'Stocktonia',
    published: 'April 1, 2026',
    reviewed: 'May 3, 2026',
    url: 'https://stocktonia.org/news/local-government/2026/04/01/stockton-approves-3-15m-police-drone-program-despite-public-opposition/'
  },
  {
    id: 'stocktonia-jun-2026',
    title: 'Stockton approved Flock drones: what the system is and why it has drawn scrutiny elsewhere',
    publisher: 'Stocktonia',
    published: 'June 8, 2026',
    url: 'https://stocktonia.org/news/local-government/2026/06/08/stockton-flock-drones-what-to-know/'
  },
  {
    id: 'stockton-portal-2026-08-08',
    title: 'Stockton CA PD public transparency portal data',
    publisher: 'Flock Safety, archived by None Below',
    sourceType: 'Archived Flock portal',
    published: 'August 8, 2026',
    reviewed: 'August 12, 2026',
    url: 'https://github.com/none-below/sm-alpr/blob/f2de8249196d54ce31322b70a69849f89997f083/assets/transparency.flocksafety.com/stockton-ca-pd/2026-08-08.json',
    note: 'Vendor-published portal data preserved by a third party; not a City-certified audit'
  },
  {
    id: 'stockton-rolling-audit',
    title: 'Search Justification Audit: Stockton CA PD',
    publisher: 'None Below',
    sourceType: 'Third-party analysis',
    reviewed: 'August 12, 2026',
    url: 'https://none-below.github.io/sm-alpr/justifications.html?agency=stockton-ca-pd'
  },
  {
    id: 'stockton-rolling-method',
    title: 'Search-justification aggregation methodology',
    publisher: 'None Below',
    sourceType: 'Third-party analysis',
    reviewed: 'August 12, 2026',
    url: 'https://github.com/none-below/sm-alpr/blob/f2de8249196d54ce31322b70a69849f89997f083/scripts/build_justifications.py',
    note: 'Modeled exposure and network-reach estimates are not documented access events'
  },
  {
    id: 'stockton-uop-pra',
    title: 'PRA 10325372 concerning UOP authorization',
    publisher: 'City of Stockton, preserved by None Below',
    sourceType: 'Stockton record',
    published: 'March 31, 2026',
    reviewed: 'August 12, 2026',
    url: 'https://github.com/none-below/sm-alpr/blob/f2de8249196d54ce31322b70a69849f89997f083/assets/public-records/stockton/10325372/PRA-10325372.pdf'
  },
  {
    id: 'california-alpr-law',
    title: 'California Civil Code sections 1798.90.5–1798.90.55',
    publisher: 'California Legislature',
    sourceType: 'Official legal/policy source',
    reviewed: 'August 12, 2026',
    url: 'https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?article=&chapter=&division=3.&lawCode=CIV&part=4.&title=1.81.23'
  },
  {
    id: 'california-ag-alpr-guidance',
    title: 'Attorney General Bulletin 2023-DLE-06',
    publisher: 'California Department of Justice',
    sourceType: 'Official legal/policy source',
    reviewed: 'August 12, 2026',
    url: 'https://www.oag.ca.gov/system/files/media/2023-dle-06.pdf'
  },
  {
    id: 'ncric-board',
    title: 'NC HIDTA Executive Board',
    publisher: 'Northern California Regional Intelligence Center',
    sourceType: 'Official legal/policy source',
    reviewed: 'August 12, 2026',
    url: 'https://ncric.ca.gov/nc-hidta-executive-board/'
  },
  {
    id: 'ncric-mou',
    title: 'Generic Data Sharing Memorandum of Understanding',
    publisher: 'Northern California Regional Intelligence Center',
    sourceType: 'Official legal/policy source',
    reviewed: 'August 12, 2026',
    url: 'https://ncric.ca.gov/wp-content/uploads/2021/10/NCRIC-Data-Sharing-MOU.pdf',
    note: 'The generic form is not evidence that Stockton executed it or contributed Flock data under it'
  },
  {
    id: 'usms-about',
    title: 'About the U.S. Marshals Service',
    publisher: 'U.S. Marshals Service',
    sourceType: 'Official legal/policy source',
    reviewed: 'August 12, 2026',
    url: 'https://www.usmarshals.gov/who-we-are/about-us'
  }
] as const satisfies readonly CampaignSource[]

export const safeguardsSources = [
  {
    id: 'mountain-view-termination',
    title: 'Flock contract termination announcement',
    publisher: 'City of Mountain View',
    published: 'February 25, 2026',
    url: 'https://content.govdelivery.com/accounts/CAMOUNTAINVIEW/bulletins/40b9366'
  },
  {
    id: 'mountain-view-council-report',
    title: 'Automated License Plate Reader contract council report',
    publisher: 'City of Mountain View',
    published: 'February 24, 2026',
    url: 'https://mountainview.legistar.com/View.ashx?M=F&ID=15262079&GUID=F6A5CD77-B3CC-44AA-A43D-307541338595'
  },
  {
    id: 'oxnard-suspension',
    title: 'Oxnard Police Department suspends use of Flock Safety automated license plate readers',
    publisher: 'City of Oxnard',
    published: 'February 27, 2026',
    url: 'https://www.oxnard.gov/pd-news/news-release-oxnard-police-department-suspends-use-of-flock-safety-automated-license-plate-readers-02-27-26'
  },
  {
    id: 'los-altos-community-message',
    title: 'Community message regarding Flock Safety automated license plate reader data',
    publisher: 'City of Los Altos',
    published: 'March 9, 2026',
    url: 'https://www.losaltosca.gov/DocumentCenter/View/2543/Community-Message-Regarding-Flock-Safety-Automated-License-Place-Reader-ALPR-Data'
  },
  {
    id: 'california-ag-el-cajon',
    title:
      'Attorney General Bonta continues legal challenge to stop El Cajon from illegally sharing license plate data',
    publisher: 'California Department of Justice',
    published: 'January 21, 2026',
    url: 'https://oag.ca.gov/news/press-releases/attorney-general-bonta-continues-legal-challenge-stop-el-cajon-illegally-sharing'
  },
  {
    id: '404-vague-search-reasons',
    title: 'Police told to be “as vague as permissible” about why they use Flock',
    publisher: '404 Media',
    published: 'January 27, 2026',
    url: 'https://www.404media.co/police-told-to-be-as-vague-as-permissible-about-why-they-use-flock/'
  }
] as const satisfies readonly CampaignSource[]

export const faqSources = [
  {
    id: 'flock-products',
    title: 'Flock products',
    publisher: 'Flock Safety',
    url: 'https://www.flocksafety.com/products',
    note: 'Vendor description'
  },
  {
    id: 'flock-license-plate-readers',
    title: 'License plate readers',
    publisher: 'Flock Safety',
    url: 'https://www.flocksafety.com/products/license-plate-readers',
    note: 'Vendor description'
  },
  {
    id: 'flock-os',
    title: 'FlockOS',
    publisher: 'Flock Safety',
    url: 'https://www.flocksafety.com/products/flock-os',
    note: 'Vendor description'
  },
  {
    id: 'flock-freeform',
    title: 'FreeForm search',
    publisher: 'Flock Safety',
    url: 'https://www.flocksafety.com/products/flock-freeform',
    note: 'Vendor description'
  },
  {
    id: 'flock-dfr',
    title: 'Drone as First Responder',
    publisher: 'Flock Safety',
    url: 'https://www.flocksafety.com/products/flock-dfr',
    note: 'Vendor description'
  },
  {
    id: 'flock-safe-cities',
    title: 'Safe Cities platform',
    publisher: 'Flock Safety',
    url: 'https://www.flocksafety.com/safe-cities',
    note: 'Vendor description'
  },
  {
    id: 'ap-border-patrol',
    title: 'Border Patrol is monitoring U.S. drivers and detaining those with suspicious travel patterns',
    publisher: 'The Associated Press',
    published: 'October 29, 2025',
    url: 'https://www.ap.org/news-highlights/spotlights/2025/border-patrol-is-monitoring-us-drivers-and-detaining-those-with-suspicious-travel-patterns/'
  },
  {
    id: 'aclu-flock-terms',
    title: 'Municipalities: beware of changes in Flock’s legal terms',
    publisher: 'American Civil Liberties Union',
    url: 'https://www.aclu.org/news/privacy-technology/tracking-alpr-cameras/flocks-terms-and-conditions'
  },
  {
    id: 'aclu-cancellation-resolution',
    title: 'Model resolution for local Flock contract cancellation',
    publisher: 'American Civil Liberties Union',
    url: 'https://www.aclu.org/documents/model-resolution-for-local-flock-contract-cancellation'
  },
  {
    id: 'aclu-alpr-public-data',
    title: 'License plate readings should not be public data',
    publisher: 'American Civil Liberties Union',
    url: 'https://www.aclu.org/news/privacy-technology/tracking-alpr-cameras/alpr-as-public-data'
  },
  {
    id: 'eff-alpr',
    title: 'Data Driven: What Is ALPR?',
    publisher: 'Electronic Frontier Foundation',
    url: 'https://www.eff.org/pages/what-alpr'
  }
] as const satisfies readonly CampaignSource[]

export const allCampaignSources = [...stocktonSources, ...safeguardsSources, ...faqSources] as const
