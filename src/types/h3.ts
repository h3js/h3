import type { H3EventContext } from "./context.ts";
import type { HTTPHandler, EventHandler, Middleware } from "./handler.ts";
import type { HTTPError } from "../error.ts";
import type { MaybePromise } from "./_utils.ts";
import type { FetchHandler, ServerRequest } from "srvx";
// import type { MatchedRoute, RouterContext } from "rou3";
import type { H3Event } from "../event.ts";
import type { H3Plugin } from "../plugin.ts";
import type { ComposedMiddleware } from "../middleware.ts";

// Inlined from rou3 for type portability
export interface RouterContext {
  root: any;
  static: Record<string, any>;
}

export type MatchedRoute<T = any> = {
  data: T;
  params?: Record<string, string>;
};

// --- Misc ---

// https://www.rfc-editor.org/rfc/rfc7231#section-4.1
// prettier-ignore
export type HTTPMethod =  "GET" | "HEAD" | "PATCH" | "POST" | "PUT" | "DELETE" | "CONNECT" | "OPTIONS" | "TRACE" | "QUERY";

export interface H3Config {
  /**
   * When enabled, H3 displays debugging stack traces in HTTP responses (potentially dangerous for production!).
   */
  debug?: boolean;

  /**
   * When enabled, H3 console errors for unhandled exceptions will not be displayed.
   */
  silent?: boolean;

  /**
   * By default H3 rejects requests with a malformed percent-encoded URL path
   * (e.g. `/foo%`, `/%ZZ`) with a `400 Bad Request` before routing.
   *
   * When enabled, such requests are allowed through with the raw, undecoded
   * pathname instead. Your handlers are then responsible for handling it safely.
   */
  allowMalformedURL?: boolean;

  plugins?: H3Plugin[];

  onRequest?: (event: H3Event) => MaybePromise<void>;
  onResponse?: (response: Response, event: H3Event) => MaybePromise<void>;
  onError?: (error: HTTPError, event: H3Event) => MaybePromise<void | unknown>;
}

export type H3CoreConfig = Omit<H3Config, "plugins">;

export type PreparedResponse = ResponseInit & { body?: BodyInit | null };

export interface H3RouteMeta {
  readonly [key: string]: unknown;
}

export interface H3Route {
  route?: string;
  method?: HTTPMethod;
  middleware?: Middleware[];
  meta?: H3RouteMeta;
  handler: EventHandler;

  /**
   * Cached composition of `middleware` + `handler` (built on first match).
   * @internal
   */
  "~composed"?: EventHandler;
}

// --- H3 App ---

export type RouteOptions = {
  middleware?: Middleware[];
  meta?: H3RouteMeta;
};

export type MiddlewareOptions = {
  method?: string;
  match?: (event: H3Event) => boolean;
};

export declare class H3Core {
  /**
   * H3 instance config.
   */
  readonly config: H3Config;

  /** @internal */
  "~middleware": Middleware[];

  /**
   * Cached composition of `~middleware` (invalidated by `use()` and `mount()`).
   * @internal
   */
  "~composed"?: ComposedMiddleware;

  /** @internal */
  "~routes": H3Route[];

  /**
   * Create a new H3 app instance.
   */
  constructor(config?: H3Config);

  /**
   * A [fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)-compatible API allowing to fetch app routes.
   *
   * Input should be standard [Request](https://developer.mozilla.org/en-US/docs/Web/API/Request) object.
   *
   * Returned value is a [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) Promise.
   */
  fetch(_request: ServerRequest): Response | Promise<Response>;

  /**
   * An h3 compatible event handler useful to compose multiple h3 app instances.
   */
  handler(event: H3Event): unknown | Promise<unknown>;

  /** @internal */
  "~request"(request: ServerRequest, context?: H3EventContext): Response | Promise<Response>;

  /** @internal */
  "~findRoute"(_event: H3Event): MatchedRoute<H3Route> | void;

  /**
   * Returns the middleware chain for an event. Can be overridden (subclass method or
   * instance assignment) to provide dynamic per-event middleware, which disables
   * middleware precomposition. Override before handling the first request — the
   * dispatch strategy is cached and only re-evaluated after `use()` or `mount()`.
   * @internal
   */
  "~getMiddleware"(event: H3Event, route: MatchedRoute<H3Route> | undefined): Middleware[];

  /** @internal */
  "~addRoute"(_route: H3Route): void;
}

export declare class H3 extends H3Core {
  /** @internal */
  "~rou3": RouterContext;

  /**
   * A [fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)-compatible API allowing to fetch app routes.
   *
   * Input can be a URL, relative path or standard [Request](https://developer.mozilla.org/en-US/docs/Web/API/Request) object.
   *
   * Returned value is a [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) Promise.
   */
  request(
    request: ServerRequest | URL | string,
    options?: RequestInit,
    context?: H3EventContext,
  ): Response | Promise<Response>;

  /**
   * Register a global middleware.
   */
  use(route: string, handler: Middleware | H3, opts?: MiddlewareOptions): this;
  use(handler: Middleware | H3, opts?: MiddlewareOptions): this;

  /**
   * Register a route handler for the specified HTTP method and route.
   */
  on(
    method: HTTPMethod | Lowercase<HTTPMethod> | "",
    route: string,
    handler: HTTPHandler,
    opts?: RouteOptions,
  ): this;

  /**
   * Immediately register an H3 plugin.
   */
  register(plugin: H3Plugin): this;

  /**
   * Mount an H3 app or a `.fetch` compatible server (like Hono or Elysia) with a base prefix.
   *
   * When mounting a sub-app, all routes will be added with base prefix and global middleware will be added as one prefixed middleware.
   *
   * **Note:** Sub-app options and global hooks are not inherited by the mounted app please consider setting them in the main app directly.
   */
  mount(base: string, input: FetchHandler | { fetch: FetchHandler } | H3): this;

  /**
   * Register a route handler for all HTTP methods.
   */
  all(route: string, handler: HTTPHandler, opts?: RouteOptions): this;

  get(route: string, handler: HTTPHandler, opts?: RouteOptions): this;
  post(route: string, handler: HTTPHandler, opts?: RouteOptions): this;
  put(route: string, handler: HTTPHandler, opts?: RouteOptions): this;
  delete(route: string, handler: HTTPHandler, opts?: RouteOptions): this;
  patch(route: string, handler: HTTPHandler, opts?: RouteOptions): this;
  head(route: string, handler: HTTPHandler, opts?: RouteOptions): this;
  options(route: string, handler: HTTPHandler, opts?: RouteOptions): this;
  connect(route: string, handler: HTTPHandler, opts?: RouteOptions): this;
  trace(route: string, handler: HTTPHandler, opts?: RouteOptions): this;
  query(route: string, handler: HTTPHandler, opts?: RouteOptions): this;
}
