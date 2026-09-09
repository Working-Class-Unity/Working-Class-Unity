import { setResponseHeader } from 'h3'
import { getAppRuntimeConfig } from '../utils/runtime'
import { renderSitemap } from '../utils/site-discovery'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')
  return renderSitemap(getAppRuntimeConfig().public.appUrl)
})
