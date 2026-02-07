export interface Building {
  id: string
  name: string
  streetAddress: string
  city: string
  state: string
  zip: string
  status: 'target' | 'active' | 'won' | 'paused'
}

export interface Landlord {
  id: string
  legalName: string
  contactEmail: string | null
  contactPhone: string | null
}

export interface OutreachInteraction {
  id: string
  buildingId: string
  organizerUserId: string
  occurredAt: string
  interactionType: 'door-knock' | 'phone' | 'meeting' | 'follow-up'
  notes: string
}

export interface OrganizingSummaryResponse {
  totalBuildings: number
  activeBuildings: number
  outreachLast30Days: number
  recentInteractions: OutreachInteraction[]
}
