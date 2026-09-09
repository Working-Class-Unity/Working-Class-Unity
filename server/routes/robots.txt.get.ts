import { setResponseHeader } from 'h3'
import { getAppRuntimeConfig } from '../utils/runtime'
import { renderRobotsText } from '../utils/site-discovery'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return renderRobotsText(getAppRuntimeConfig().public.appUrl)
})
