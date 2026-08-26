import type { DatabaseConnection } from '../../db/connect'
import { createIdentityReviewEmail, type TransactionalEmailSender } from '../email'
import type { JobHandler, JobPayload } from '../jobs/job-queue'

export const identityReviewNotificationJobType = 'identity.review-notification'

export function createIdentityReviewNotificationHandler(context: {
  appName: string
  connection: DatabaseConnection
  sender: TransactionalEmailSender
}): JobHandler {
  return async (payload) => {
    const { reviewId } = parsePayload(payload)
    const review = context.connection.sqlite
      .prepare(
        `select id, reason, user_id as userId
         from identity_link_reviews where id = ? and status = 'open'`
      )
      .get(reviewId) as { id: string; reason: string; userId: string } | undefined
    if (!review) return

    await context.sender.send(
      createIdentityReviewEmail({
        appName: context.appName,
        reason: review.reason,
        reviewId: review.id,
        userId: review.userId
      })
    )
  }
}

function parsePayload(payload: JobPayload): { reviewId: string } {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 1 ||
    typeof payload.reviewId !== 'string' ||
    !/^identity_review_[0-9a-f-]{36}$/.test(payload.reviewId)
  ) {
    throw new Error('Invalid identity review notification payload')
  }
  return { reviewId: payload.reviewId }
}
