import { z } from 'zod'
import { maxFileUploadBytes } from './files'

// A 16-byte MD5 value encodes as 22 significant base64 characters plus `==`.
// The last significant character is restricted to the four values with zero
// padding bits so alternate, non-canonical encodings are rejected.
const canonicalContentMd5Pattern = /^[A-Za-z0-9+/]{21}[AQgw]==$/
const conservativeMediaTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i

export const contentMd5Schema = z.string().regex(canonicalContentMd5Pattern, 'Expected canonical base64 MD5')
export const contentTypeSchema = z
  .string()
  .trim()
  .min(3)
  .max(180)
  .regex(conservativeMediaTypePattern, 'Expected a media type without parameters')
  .transform((value) => value.toLowerCase())

export const fileParamsSchema = z.object({
  id: z.string().trim().min(1).max(128)
})

const fileUploadMetadataSchema = z
  .object({
    contentType: contentTypeSchema,
    byteSize: z.number().int().min(1).max(maxFileUploadBytes),
    contentMd5: contentMd5Schema
  })
  .strict()

export const createFileUploadRequestSchema = fileUploadMetadataSchema
  .extend({
    filename: z.string().trim().min(1).max(180).optional()
  })
  .strict()

// Integrity is committed when upload initiation creates the pending row. The
// completion endpoint verifies persisted metadata and accepts no replacement.
export const completeFileUploadSchema = z.object({}).strict()

export const uploadTokenQuerySchema = z.object({
  token: z.string().trim().min(1).max(4096)
})

export type CreateFileUploadRequest = z.infer<typeof createFileUploadRequestSchema>
export type CompleteFileUploadRequest = z.infer<typeof completeFileUploadSchema>
