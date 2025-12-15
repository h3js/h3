import type { H3Event } from "./event.ts";
import {
  definePlugin,
  type H3Plugin,
  type H3Route,
  type MiddlewareOptions,
} from "./types/h3.ts";
import type { EventHandler, Middleware } from "./types/handler.ts";

export type HandlerType = "middleware" | "route";

export interface H3THandlerTracePayload {
  event: H3Event;
  route?: string;
  type: HandlerType;
}

type MaybeTracedMiddleware = Middleware & { __traced__?: boolean };
type MaybeTracedEventHandler = EventHandler & { __traced__?: boolean };

export interface TracingPluginOptions {
  traceMiddlewares?: boolean;
  traceRoutes?: boolean;
}

/**
 * Enables tracing for H3 apps.
 */
export const tracingPlugin = (traceOpts?: TracingPluginOptions): H3Plugin => {
  return definePlugin((h3) => {
    const { tracingChannel } =
      globalThis.process.getBuiltinModule?.("diagnostics_channel") ?? {};

    // If tracingChannel is not available, then we can't trace request handlers
    if (!tracingChannel) {
      return;
    }

    const requestHandlerChannel = tracingChannel("h3.request.handler");

    function wrapMiddleware(middleware: MaybeTracedMiddleware): Middleware {
      if (middleware.__traced__ || traceOpts?.traceMiddlewares === false) {
        return middleware;
      }

      const wrappedMiddleware: MaybeTracedMiddleware = (...args) => {
        return requestHandlerChannel.tracePromise(
          async () => await middleware(...args),
          {
            event: args[0],
            type: "middleware",
          } satisfies H3THandlerTracePayload,
        );
      };
      wrappedMiddleware.__traced__ = true;

      return wrappedMiddleware;
    }

    function wrapEventHandler(handler: MaybeTracedEventHandler): EventHandler {
      if (handler.__traced__ || traceOpts?.traceRoutes === false) {
        return handler;
      }

      const wrappedHandler: MaybeTracedEventHandler = (...args) => {
        return requestHandlerChannel.tracePromise(
          async () => await handler(...args),
          {
            event: args[0],
            type: "route",
          } satisfies H3THandlerTracePayload,
        );
      };
      wrappedHandler.__traced__ = true;

      return wrappedHandler;
    }

    h3["~middleware"] = h3["~middleware"].map((m) => wrapMiddleware(m));
    h3["~routes"] = h3["~routes"].map((route) => {
      return {
        ...route,
        handler: wrapEventHandler(route.handler),
        middleware: route.middleware
          ? route.middleware.map((m) => wrapMiddleware(m))
          : undefined,
      } satisfies H3Route;
    });

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
        lastRoute.middleware = lastRoute.middleware?.map((m) =>
          wrapMiddleware(m),
        );
      }

      return instance;
    };

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

    // TODO: Trace mount

    return h3;
  })();
};
