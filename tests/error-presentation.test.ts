import { describe, expect, it } from 'vitest'
import { resolvePublicErrorPresentation } from '../shared/error-presentation'

describe('public error presentation', () => {
  it('maps an unexpected server failure to generic public copy without private details', () => {
    const privateDetail = 'PRIVATE_500_DETAIL_MUST_NOT_RENDER'
    const privateError = {
      statusCode: 500,
      message: privateDetail,
      statusMessage: privateDetail,
      data: { privateDetail }
    }
    const presentation = resolvePublicErrorPresentation(privateError)

    expect(presentation).toEqual({
      statusCode: 500,
      kind: 'unexpected'
    })
    expect(JSON.stringify(presentation)).not.toContain(privateDetail)
  })

  it('maps missing pages to their public state', () => {
    expect(resolvePublicErrorPresentation({ statusCode: 404 })).toEqual({
      statusCode: 404,
      kind: 'notFound'
    })
  })
})
