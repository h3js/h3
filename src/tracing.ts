import type { H3Event } from "./event.ts";
import type { H3, H3Core } from "./h3.ts";
import {
  type H3Plugin,
  type H3Route,
  type MatchedRoute,
  type MiddlewareOptions,
} from "./types/h3.ts";
import type { EventHandler, Middleware } from "./types/handler.ts";

/**
 * Payload sent to the tracing channels.
 */
export interface TracingRequestEvent {
  type: "middleware" | "route";
  event: H3Event;
}

type MaybeTracedMiddleware = Middleware & { __traced__?: boolean };
type MaybeTracedEventHandler = EventHandler & { __traced__?: boolean };

/**
 * Options for the tracing plugin.
 */
export interface TracingPluginOptions {
  /**
   * Whether to trace middleware executions.
   */
  traceMiddleware?: boolean;
  /**
   * Whether to trace route executions.
   */
  traceRoutes?: boolean;
}

/**
 * Enables tracing for H3 apps.
 */
export function tracingPlugin(traceOpts?: TracingPluginOptions): H3Plugin {
  return (h3: H3 | H3Core) => {
    const { tracingChannel } = globalThis.process?.getBuiltinModule?.("diagnostics_channel") ?? {};

    // If tracingChannel is not available, then we can't trace request handlers
    if (!tracingChannel) {
      return;
    }

    const requestHandlerChannel = tracingChannel("h3.request");

    function wrapMiddleware(middleware: MaybeTracedMiddleware): Middleware {
      if (middleware.__traced__ || traceOpts?.traceMiddleware === false) {
        return middleware;
      }

      const wrappedMiddleware: MaybeTracedMiddleware = (...args) => {
        return requestHandlerChannel.tracePromise(async () => middleware(...args), {
          event: args[0],
          type: "middleware",
        } satisfies TracingRequestEvent);
      };
      wrappedMiddleware.__traced__ = true;

      return wrappedMiddleware;
    }

    function wrapEventHandler(handler: MaybeTracedEventHandler): EventHandler {
      if (handler.__traced__ || traceOpts?.traceRoutes === false) {
        return handler;
      }

      const wrappedHandler: MaybeTracedEventHandler = (...args) => {
        return requestHandlerChannel.tracePromise(async () => handler(...args), {
          event: args[0],
          type: "route",
        } satisfies TracingRequestEvent);
      };
      wrappedHandler.__traced__ = true;

      return wrappedHandler;
    }

    h3["~middleware"] = h3["~middleware"].map((m) => wrapMiddleware(m));
    h3["~routes"] = h3["~routes"].map((route) => {
      return {
        ...route,
        handler: wrapEventHandler(route.handler),
        middleware: route.middleware ? route.middleware.map((m) => wrapMiddleware(m)) : undefined,
      } satisfies H3Route;
    });

    if ("on" in h3 && typeof h3.on === "function") {
      const originalOn = h3.on;

      h3.on = (...args) => {
        const instance = originalOn.apply(h3, args);
        // Since it uses route push, we can wrap the last route handler added
        // Wrapping the handler at the arg level is problematic because we need the `event` to be passed to the tracePromise.
        // Which is only available with `toEventHandler` and it is already called in the `on` method.
        // eslint-disable-next-line unicorn/prefer-at
        const lastRoute = instance["~routes"][instance["~routes"].length - 1];
        if (lastRoute) {
          lastRoute.handler = wrapEventHandler(lastRoute.handler);
          lastRoute.middleware = lastRoute.middleware?.map((m) => wrapMiddleware(m));
        }

        return instance;
      };
    }

    if ("use" in h3 && typeof h3.use === "function") {
      const originalUse = h3.use;
      h3.use = (arg1: unknown, arg2?: unknown, arg3?: unknown) => {
        // Middlewares should be wrapped at the arg level to avoid creating trace events for skipped wrappers added by h3
        let route: string | undefined;
        let fn: Middleware;
        let opts: MiddlewareOptions | undefined;

        if (typeof arg1 === "string") {
          route = arg1 as string;
          fn = arg2 as Middleware;
          opts = arg3 as MiddlewareOptions;

          // @ts-expect-error - call not accepting the route signature
          return originalUse.call(h3, route, wrapMiddleware(fn), opts);
        }

        fn = arg1 as Middleware;
        opts = arg2 as MiddlewareOptions;

        return originalUse.call(h3, wrapMiddleware(fn), opts);
      };
    }

    if ("mount" in h3 && typeof h3.mount === "function") {
      const originalMount = h3.mount;
      h3.mount = (base, input) => {
        // If the input is an H3 instance
        // then we can register the tracing plugin on it to propagate the tracing to the nested app
        if ("register" in input) {
          input.register(tracingPlugin(traceOpts));
        }

        return originalMount.call(h3, base, input);
      };
    }

    return h3;
  };
}

type FindRouteFunction = (event: H3Event) => MatchedRoute<H3Route> | void;

/**
 * Wraps a `~findRoute` function so that returned route handlers and middleware
 * are traced via the `h3.request` diagnostics channel. Intended for frameworks
 * (e.g. nitro) that resolve routes at request time without pushing them into
 * `h3["~routes"]`.
 *
 * Returns the original function unchanged when `diagnostics_channel` is not
 * available.
 */
export function wrapFindRouteWithTracing(
  findRoute: FindRouteFunction,
  traceOpts?: TracingPluginOptions,
): FindRouteFunction {
  const { tracingChannel } = globalThis.process?.getBuiltinModule?.("diagnostics_channel") ?? {};

  if (!tracingChannel) {
    return findRoute;
  }

  const channel = tracingChannel("h3.request");

  function wrapHandler(handler: MaybeTracedEventHandler): EventHandler {
    if (handler.__traced__ || traceOpts?.traceRoutes === false) {
      return handler;
    }
    const wrapped: MaybeTracedEventHandler = (...args) => {
      return channel.tracePromise(async () => handler(...args), {
        event: args[0],
        type: "route",
      } satisfies TracingRequestEvent);
    };
    wrapped.__traced__ = true;
    return wrapped;
  }

  function wrapMiddleware(middleware: MaybeTracedMiddleware): Middleware {
    if (middleware.__traced__ || traceOpts?.traceMiddleware === false) {
      return middleware;
    }
    const wrapped: MaybeTracedMiddleware = (...args) => {
      return channel.tracePromise(async () => middleware(...args), {
        event: args[0],
        type: "middleware",
      } satisfies TracingRequestEvent);
    };
    wrapped.__traced__ = true;
    return wrapped;
  }

  return (event: H3Event) => {
    const route = findRoute(event);
    if (route?.data.handler) {
      route.data.handler = wrapHandler(route.data.handler);
    }
    if (route?.data.middleware) {
      for (let i = 0; i < route.data.middleware.length; i++) {
        route.data.middleware[i] = wrapMiddleware(route.data.middleware[i]);
      }
    }
    return route;
  };
}
