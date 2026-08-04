import { createInsertSchema } from 'drizzle-zod'
import { z } from 'zod'
import { PROJECT_NAME_MAX_LENGTH } from '#shared/projects'
import { projects } from './projects'

const projectNameSchema = z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH)

export const createProjectSchema = createInsertSchema(projects, {
  name: projectNameSchema
})
  .pick({
    name: true
  })
  .strict()

export const updateProjectSchema = z
  .object({
    name: projectNameSchema
  })
  .strict()

export const projectParamsSchema = z.object({
  projectId: z.string().trim().min(1).max(160)
})

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
