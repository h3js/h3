// H3

export type {
  H3Config,
  H3Plugin,
  H3Route,
  H3RouteMeta,
  HTTPMethod,
  PreparedResponse,
  RouteOptions,
  MiddlewareOptions,
  FetchHandler,
} from "./types/h3.ts";

export { definePlugin } from "./types/h3.ts";

export { H3Core, H3 } from "./h3.ts";

// Event

export type { H3EventContext } from "./types/context.ts";
export { H3Event } from "./event.ts";
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
  EventHandlerObject,
} from "./types/handler.ts";

export {
  defineHandler,
  defineLazyEventHandler,
  dynamicEventHandler,
  defineValidatedHandler,
} from "./handler.ts";

export { defineJsonRpcHandler } from "./utils/json-rpc.ts";

export { defineMiddleware } from "./middleware.ts";

// Response

export { toResponse } from "./response.ts";

// Error

export type { ErrorDetails, ErrorBody, ErrorInput } from "./error.ts";

export { HTTPError } from "./error.ts";

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

// Route
export { defineRoute } from "./utils/route.ts";
export type { RouteDefinition } from "./utils/route.ts";

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
  html,
} from "./utils/response.ts";

// Middleware
export { onError, onRequest, onResponse } from "./utils/middleware.ts";

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
export {
  type BasicAuthOptions,
  requireBasicAuth,
  basicAuth,
} from "./utils/auth.ts";

// Fingerprint
export {
  type RequestFingerprintOptions,
  getRequestFingerprint,
} from "./utils/fingerprint.ts";

// WebSocket
export { defineWebSocketHandler, defineWebSocket } from "./utils/ws.ts";

// ---- Deprecated ----

export * from "./_deprecated.ts";
