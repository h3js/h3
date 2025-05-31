// H3

export type {
  H3Config,
  H3Route,
  HTTPMethod,
  PreparedResponse,
} from "./types/h3.ts";

export { H3, serve } from "./h3.ts";

// Event

export type { H3Event, H3EventContext } from "./types/event.ts";

export { isEvent, mockEvent } from "./utils/event.ts";

// Handler and Middleware

export type {
  EventHandler,
  DynamicEventHandler,
  EventHandlerRequest,
  EventHandlerResponse,
  InferEventInput,
  LazyEventHandler,
  Middleware,
  MiddlewareOptions,
} from "./types/handler.ts";

export {
  defineEventHandler,
  defineLazyEventHandler,
  dynamicEventHandler,
} from "./handler.ts";

export { defineMiddleware } from "./middleware.ts";

// Error

export { type H3Error, createError, isError } from "./error.ts";

// Adapters

export {
  type NodeHandler,
  type NodeMiddleware,
  fromWebHandler,
  toWebHandler,
  fromNodeHandler,
  toNodeHandler,
  defineNodeHandler,
  defineNodeMiddleware,
} from "./adapters.ts";

// ------ Utils ------

// Request
export {
  getRequestHost,
  getRequestIP,
  getRequestProtocol,
  getRequestURL,
  isMethod,
  getQuery,
  getValidatedQuery,
  assertMethod,
  getRouterParam,
  getRouterParams,
  getValidatedRouterParams,
} from "./utils/request.ts";

// Response
export {
  writeEarlyHints,
  redirect,
  iterable,
  noContent,
} from "./utils/response.ts";

// Proxy
export {
  type ProxyOptions,
  proxy,
  getProxyRequestHeaders,
  proxyRequest,
  fetchWithEvent,
} from "./utils/proxy.ts";

// Body
export { readBody, readValidatedBody } from "./utils/body.ts";

// Cookie
export {
  getCookie,
  deleteCookie,
  parseCookies,
  setCookie,
} from "./utils/cookie.ts";

// SSE
export {
  type EventStreamMessage,
  type EventStreamOptions,
  createEventStream,
} from "./utils/event-stream.ts";

// Sanitize
export { sanitizeStatusCode, sanitizeStatusMessage } from "./utils/sanitize.ts";

// Cache
export { type CacheConditions, handleCacheHeaders } from "./utils/cache.ts";

// Static
export {
  type ServeStaticOptions,
  type StaticAssetMeta,
  serveStatic,
} from "./utils/static.ts";

// Base
export { withBase } from "./utils/base.ts";

// Session
export {
  type Session,
  type SessionConfig,
  type SessionData,
  clearSession,
  getSession,
  sealSession,
  unsealSession,
  updateSession,
  useSession,
} from "./utils/session.ts";

// Cors
export {
  type CorsOptions,
  handleCors,
  appendCorsHeaders,
  appendCorsPreflightHeaders,
  isCorsOriginAllowed,
  isPreflightRequest,
} from "./utils/cors.ts";

// Auth
export { withBasicAuth } from "./utils/auth";

// Fingerprint
export {
  type RequestFingerprintOptions,
  getRequestFingerprint,
} from "./utils/fingerprint.ts";

// WebSocket
export { defineWebSocketHandler, defineWebSocket } from "./utils/ws.ts";

// ---- Deprecated ----

export * from "./_deprecated.ts";
