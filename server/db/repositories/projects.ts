import { and, asc, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { DatabaseConnection } from '../connect'
import { projects, type CreateProjectInput, type UpdateProjectInput } from '../schema'

const projectProjection = {
  id: projects.id,
  name: projects.name,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt
}

export type ProjectProjection = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export async function listProjects(connection: DatabaseConnection, ownerUserId: string): Promise<ProjectProjection[]> {
  return connection.db
    .select(projectProjection)
    .from(projects)
    .where(eq(projects.ownerUserId, ownerUserId))
    .orderBy(desc(projects.createdAt), asc(projects.id))
}

export async function createProject(
  connection: DatabaseConnection,
  ownerUserId: string,
  input: CreateProjectInput
): Promise<ProjectProjection> {
  const now = new Date().toISOString()
  const id = `project_${randomUUID()}`

  const [project] = await connection.db
    .insert(projects)
    .values({
      id,
      ownerUserId,
      ...input,
      createdAt: now,
      updatedAt: now
    })
    .returning(projectProjection)

  if (!project) {
    throw new Error('Failed to create project')
  }

  return project
}

export async function getProjectById(
  connection: DatabaseConnection,
  ownerUserId: string,
  projectId: string
): Promise<ProjectProjection | null> {
  const [project] = await connection.db
    .select(projectProjection)
    .from(projects)
    .where(and(eq(projects.ownerUserId, ownerUserId), eq(projects.id, projectId)))
    .limit(1)
  return project ?? null
}

export async function updateProject(
  connection: DatabaseConnection,
  ownerUserId: string,
  projectId: string,
  input: UpdateProjectInput
): Promise<ProjectProjection | null> {
  const [project] = await connection.db
    .update(projects)
    .set({
      ...input,
      updatedAt: new Date().toISOString()
    })
    .where(and(eq(projects.ownerUserId, ownerUserId), eq(projects.id, projectId)))
    .returning(projectProjection)

  return project ?? null
}

export async function deleteProject(
  connection: DatabaseConnection,
  ownerUserId: string,
  projectId: string
): Promise<boolean> {
  const [deleted] = await connection.db
    .delete(projects)
    .where(and(eq(projects.ownerUserId, ownerUserId), eq(projects.id, projectId)))
    .returning({ id: projects.id })

  return Boolean(deleted)
}
