import { describe, expect, it } from 'vitest'
import { resolvePublicErrorPresentation } from '../shared/error-presentation'
import { moduleDisabledCode } from '../shared/module-states'

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
      kind: 'unexpected',
      showModuleCode: false
    })
    expect(JSON.stringify(presentation)).not.toContain(privateDetail)
  })

  it('maps missing pages and disabled modules to their specific public states', () => {
    expect(resolvePublicErrorPresentation({ statusCode: 404 })).toEqual({
      statusCode: 404,
      kind: 'notFound',
      showModuleCode: false
    })
    expect(
      resolvePublicErrorPresentation({
        status: 404,
        data: { code: moduleDisabledCode, module: 'observability' }
      })
    ).toEqual({
      statusCode: 404,
      kind: 'moduleUnavailable',
      showModuleCode: true
    })
  })
})
