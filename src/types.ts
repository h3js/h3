import type http from 'http'
import type { H3Event, H3EventContext } from './event'

interface CompatibilityRequestProps {
  event: H3Event
  context: H3EventContext
  /** Only available with connect and press */
  originalUrl?: string
}

export interface IncomingMessage extends http.IncomingMessage, CompatibilityRequestProps {
  req: H3Event['req'],
  res: H3Event['res']
}
export interface ServerResponse extends http.ServerResponse{
  event: H3Event,
  res: H3Event['res']
  req: http.ServerResponse['req'] & CompatibilityRequestProps
}

export type Handler<T = any, ReqT={}> = (req: IncomingMessage & ReqT, res: ServerResponse) => T
export type PromisifiedHandler = Handler<Promise<any>>
export type Middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: Error) => any) => any
export type LazyHandler = () => Handler | Promise<Handler>

// Node.js
export type Encoding = false | 'ascii' | 'utf8' | 'utf-8' | 'utf16le' | 'ucs2' | 'ucs-2' | 'base64' | 'latin1' | 'binary' | 'hex'

// https://www.rfc-editor.org/rfc/rfc7231#section-4.1
export type HTTPMethod = 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'OPTIONS' | 'TRACE'
