import { setResponseHeader } from 'h3'
import { getAppRuntimeConfig } from '../utils/runtime'
import { renderLlmsText } from '../utils/site-discovery'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return renderLlmsText(getAppRuntimeConfig().public.appUrl)
})
