import type { DatabaseConnection } from '../../db/connect'

export class IdentityReviewResolutionError extends Error {
  constructor() {
    super('Identity review could not be resolved')
    this.name = 'IdentityReviewResolutionError'
  }
}

export type ResolveIdentityReviewInput = Readonly<{
  personId: string
  resolvedAt?: Date
  reviewId: string
}>

export type ResolvedIdentityReview = Readonly<{
  personId: string
  resolvedAt: string
  reviewId: string
  userId: string
}>

export function resolveIdentityLinkReview(
  connection: DatabaseConnection,
  input: ResolveIdentityReviewInput
): ResolvedIdentityReview {
  const resolvedAt = (input.resolvedAt ?? new Date()).toISOString()

  return connection.sqlite
    .transaction(() => {
      const review = connection.sqlite
        .prepare(
          `select id, user_id as userId from identity_link_reviews
           where id = ? and status = 'open'`
        )
        .get(input.reviewId) as { id: string; userId: string } | undefined
      if (!review) throw new IdentityReviewResolutionError()

      const person = connection.sqlite.prepare('select id from people where id = ?').get(input.personId)
      if (!person) throw new IdentityReviewResolutionError()

      const userLink = connection.sqlite
        .prepare('select person_id as personId from person_accounts where user_id = ?')
        .get(review.userId) as { personId: string } | undefined
      if (userLink && userLink.personId !== input.personId) throw new IdentityReviewResolutionError()

      const personLink = connection.sqlite
        .prepare('select user_id as userId from person_accounts where person_id = ?')
        .get(input.personId) as { userId: string } | undefined
      if (personLink && personLink.userId !== review.userId) throw new IdentityReviewResolutionError()

      if (!userLink) {
        connection.sqlite
          .prepare('insert into person_accounts (person_id, user_id, linked_at) values (?, ?, ?)')
          .run(input.personId, review.userId, resolvedAt)
      }

      const updated = connection.sqlite
        .prepare(
          `update identity_link_reviews
           set status = 'resolved', resolved_person_id = ?, resolved_at = ?, updated_at = ?
           where id = ? and status = 'open'`
        )
        .run(input.personId, resolvedAt, resolvedAt, input.reviewId)
      if (updated.changes !== 1) throw new IdentityReviewResolutionError()

      return Object.freeze({
        personId: input.personId,
        resolvedAt,
        reviewId: input.reviewId,
        userId: review.userId
      })
    })
    .immediate()
}
