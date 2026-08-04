export const PROJECT_NAME_MAX_LENGTH = 120

export type ProjectView = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export type ProjectCollectionView = {
  projects: ProjectView[]
}

export type ProjectItemView = {
  project: ProjectView
}
