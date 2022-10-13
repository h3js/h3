import type { H3Event } from '../event'

export interface CacheConditions {
  modifiedTime?: string | Date
  maxAge?: number
  etag?: string
  cacheControls?: string[]
}

/**
 * Check request caching headers (`If-Modified-Since`) and add caching headers (Last-Modified, Cache-Control)
 * Note: `public` cache control will be added by default
 * @returns `true` when cache headers are matching. When `true` is returned, no reponse should be sent anymore
 */
export function handleCacheHeaders (event: H3Event, opts: CacheConditions): boolean {
  const cacheControls = ['public'].concat(opts.cacheControls || [])
  let cacheMatched = false

  if (opts.maxAge !== undefined) {
    cacheControls.push(`max-age=${+opts.maxAge}`, `s-maxage=${+opts.maxAge}`)
  }

  if (opts.modifiedTime) {
    const modifiedTime = new Date(opts.modifiedTime)
    const ifModifiedSince = event.req.headers['if-modified-since']
    event.res.setHeader('Last-Modified', modifiedTime.toUTCString())
    if (ifModifiedSince) {
      if (new Date(ifModifiedSince) >= opts.modifiedTime) {
        cacheMatched = true
      }
    }
  }

  if (opts.etag) {
    event.res.setHeader('Etag', opts.etag)
    const ifNonMatch = event.req.headers['if-none-match']
    if (ifNonMatch === opts.etag) {
      cacheMatched = true
    }
  }

  event.res.setHeader('Cache-Control', cacheControls.join(', '))

  if (cacheMatched) {
    event.res.statusCode = 304
    event.res.end('')
    return true
  }

  return false
}
