// H3

export type {
  H3Config,
  H3CoreConfig,
  H3Plugin,
  H3Route,
  H3RouteMeta,
  HTTPMethod,
  PreparedResponse,
  RouteOptions,
  MiddlewareOptions,
  RouterContext,
  MatchedRoute,
} from "./types/h3.ts";

export { definePlugin } from "./types/h3.ts";

export { H3Core, H3 } from "./h3.ts";

// Event

export type { H3EventContext } from "./types/context.ts";
export { H3Event, type HTTPEvent } from "./event.ts";
export {
  isEvent,
  isHTTPEvent,
  mockEvent,
  getEventContext,
} from "./utils/event.ts";

// Handler and Middleware

export type {
  EventHandler,
  DynamicEventHandler,
  EventHandlerRequest,
  EventHandlerResponse,
  EventHandlerFetch,
  EventHandlerWithFetch,
  InferEventInput,
  LazyEventHandler,
  Middleware,
  EventHandlerObject,
  FetchHandler,
  FetchableObject,
  HTTPHandler,
  TypedServerRequest,
} from "./types/handler.ts";

export {
  defineHandler,
  defineLazyEventHandler,
  dynamicEventHandler,
  defineValidatedHandler,
  toEventHandler,
} from "./handler.ts";

export {
  defineMiddleware,
  callMiddleware,
  toMiddleware,
} from "./middleware.ts";

// Response

export { toResponse, HTTPResponse } from "./response.ts";

// Error

export {
  type ErrorDetails,
  type ErrorBody,
  type ErrorInput,
  HTTPError,
} from "./error.ts";

// Adapters

export {
  type NodeHandler,
  type NodeMiddleware,
  fromWebHandler,
  toWebHandler,
  fromNodeHandler,
  defineNodeHandler,
  defineNodeMiddleware,
} from "./adapters.ts";

// ------ Utils ------

// Route

export { type RouteDefinition, defineRoute } from "./utils/route.ts";

// Request

export {
  toRequest,
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

export {
  onError,
  onRequest,
  onResponse,
  bodyLimit,
} from "./utils/middleware.ts";

// Proxy

export {
  type ProxyOptions,
  proxy,
  getProxyRequestHeaders,
  proxyRequest,
  fetchWithEvent,
} from "./utils/proxy.ts";

// Body

export { readBody, readValidatedBody, assertBodySize } from "./utils/body.ts";

// Cookie

export {
  getCookie,
  deleteCookie,
  parseCookies,
  setCookie,
  getChunkedCookie,
  deleteChunkedCookie,
  setChunkedCookie,
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
  type SessionManager,
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

export {
  type WebSocketHooks,
  type WebSocketPeer,
  type WebSocketMessage,
  defineWebSocketHandler,
  defineWebSocket,
} from "./utils/ws.ts";

// ---- Deprecated ----

export * from "./_deprecated.ts";
