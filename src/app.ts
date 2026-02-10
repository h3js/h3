import { joinURL, parseURL, withoutTrailingSlash } from "ufo";
import type { AdapterOptions as WSOptions } from "crossws";
import {
  lazyEventHandler,
  toEventHandler,
  isEventHandler,
  eventHandler,
  H3Event,
} from "./event";
import { H3Error, createError } from "./error";
import {
  send,
  sendStream,
  isStream,
  MIMES,
  sendWebResponse,
  isWebResponse,
  sendNoContent,
} from "./utils";
import type {
  EventHandler,
  EventHandlerResolver,
  LazyEventHandler,
} from "./types";

export interface Layer {
  route: string;
  match?: Matcher;
  handler: EventHandler;
}

export type Stack = Layer[];

export interface InputLayer {
  route?: string;
  match?: Matcher;
  handler: EventHandler;
  lazy?: boolean;
}

export type InputStack = InputLayer[];

export type Matcher = (url: string, event?: H3Event) => boolean;

export interface AppUse {
  (
    route: string | string[],
    handler: EventHandler | EventHandler[],
    options?: Partial<InputLayer>,
  ): App;
  (handler: EventHandler | EventHandler[], options?: Partial<InputLayer>): App;
  (options: InputLayer): App;
}

export type WebSocketOptions = WSOptions;

export interface AppOptions {
  debug?: boolean;
  onError?: (error: H3Error, event: H3Event) => any;
  onRequest?: (event: H3Event) => void | Promise<void>;
  onBeforeResponse?: (
    event: H3Event,
    response: { body?: unknown },
  ) => void | Promise<void>;
  onAfterResponse?: (
    event: H3Event,
    response?: { body?: unknown },
  ) => void | Promise<void>;
  websocket?: WebSocketOptions;
}

export interface App {
  stack: Stack;
  handler: EventHandler;
  options: AppOptions;
  use: AppUse;
  resolve: EventHandlerResolver;
  readonly websocket: WebSocketOptions;
}

/**
 * Create a new H3 app instance.
 */
export function createApp(options: AppOptions = {}): App {
  const stack: Stack = [];

  const handler = createAppEventHandler(stack, options);

  const resolve = createResolver(stack);
  handler.__resolve__ = resolve;

  const getWebsocket = cachedFn(() => websocketOptions(resolve, options));

  const app: App = {
    // @ts-expect-error
    use: (arg1, arg2, arg3) => use(app as App, arg1, arg2, arg3),
    resolve,
    handler,
    stack,
    options,
    get websocket() {
      return getWebsocket();
    },
  };

  return app;
}

export function use(
  app: App,
  arg1: string | EventHandler | InputLayer | InputLayer[],
  arg2?: Partial<InputLayer> | EventHandler | EventHandler[],
  arg3?: Partial<InputLayer>,
) {
  if (Array.isArray(arg1)) {
    for (const i of arg1) {
      use(app, i, arg2, arg3);
    }
  } else if (Array.isArray(arg2)) {
    for (const i of arg2) {
      use(app, arg1, i, arg3);
    }
  } else if (typeof arg1 === "string") {
    app.stack.push(
      normalizeLayer({ ...arg3, route: arg1, handler: arg2 as EventHandler }),
    );
  } else if (typeof arg1 === "function") {
    app.stack.push(normalizeLayer({ ...arg2, handler: arg1 as EventHandler }));
  } else {
    app.stack.push(normalizeLayer({ ...arg1 }));
  }
  return app;
}

export function createAppEventHandler(stack: Stack, options: AppOptions) {
  const spacing = options.debug ? 2 : undefined;

  return eventHandler(async (event) => {
    // Keep original incoming url accessible
    event.node.req.originalUrl =
      event.node.req.originalUrl || event.node.req.url || "/";

    // Keep a copy of incoming url
    const _reqPath = event._path || event.node.req.url || "/";

    // Layer path is the path without the prefix
    let _layerPath: string;

    // Call onRequest hook
    if (options.onRequest) {
      await options.onRequest(event);
    }

    for (const layer of stack) {
      // 1. Remove prefix from path
      if (layer.route.length > 1) {
        if (!_reqPath.startsWith(layer.route)) {
          continue;
        }
        _layerPath = _reqPath.slice(layer.route.length) || "/";
      } else {
        _layerPath = _reqPath;
      }

      // 2. Custom matcher
      if (layer.match && !layer.match(_layerPath, event)) {
        continue;
      }

      // 3. Update event path with layer path
      event._path = _layerPath;
      event.node.req.url = _layerPath;

      // 4. Handle request
      const val = await layer.handler(event);

      // 5. Try to handle return value
      const _body = val === undefined ? undefined : await val;
      if (_body !== undefined) {
        const _response = { body: _body };
        if (options.onBeforeResponse) {
          event._onBeforeResponseCalled = true;
          await options.onBeforeResponse(event, _response);
        }
        await handleHandlerResponse(event, _response.body, spacing);
        if (options.onAfterResponse) {
          event._onAfterResponseCalled = true;
          await options.onAfterResponse(event, _response);
        }
        return;
      }

      // Already handled
      if (event.handled) {
        if (options.onAfterResponse) {
          event._onAfterResponseCalled = true;
          await options.onAfterResponse(event, undefined);
        }
        return;
      }
    }

    if (!event.handled) {
      throw createError({
        statusCode: 404,
        statusMessage: `Cannot find any path matching ${event.path || "/"}.`,
      });
    }

    if (options.onAfterResponse) {
      event._onAfterResponseCalled = true;
      await options.onAfterResponse(event, undefined);
    }
  });
}

function createResolver(stack: Stack): EventHandlerResolver {
  return async (path: string) => {
    let _layerPath: string;
    for (const layer of stack) {
      if (layer.route === "/" && !layer.handler.__resolve__) {
        continue;
      }
      if (!path.startsWith(layer.route)) {
        continue;
      }
      _layerPath = path.slice(layer.route.length) || "/";
      if (layer.match && !layer.match(_layerPath, undefined)) {
        continue;
      }
      let res = { route: layer.route, handler: layer.handler };
      if (res.handler.__resolve__) {
        const _res = await res.handler.__resolve__(_layerPath);
        if (!_res) {
          continue;
        }
        res = {
          ...res,
          ..._res,
          route: joinURL(res.route || "/", _res.route || "/"),
        };
      }
      return res;
    }
  };
}

function normalizeLayer(input: InputLayer) {
  let handler = input.handler;
  // @ts-ignore
  if (handler.handler) {
    // @ts-ignore
    handler = handler.handler;
  }

  if (input.lazy) {
    handler = lazyEventHandler(handler as LazyEventHandler);
  } else if (!isEventHandler(handler)) {
    handler = toEventHandler(handler, undefined, input.route);
  }

  return {
    route: withoutTrailingSlash(input.route),
    match: input.match,
    handler,
  } as Layer;
}

function handleHandlerResponse(event: H3Event, val: any, jsonSpace?: number) {
  // Empty Content
  if (val === null) {
    return sendNoContent(event);
  }

  if (val) {
    // Web Response
    if (isWebResponse(val)) {
      return sendWebResponse(event, val);
    }

    // Stream
    if (isStream(val)) {
      return sendStream(event, val);
    }

    // Buffer
    if (val.buffer) {
      return send(event, val);
    }

    // Blob
    if (val.arrayBuffer && typeof val.arrayBuffer === "function") {
      return (val as Blob).arrayBuffer().then((arrayBuffer) => {
        return send(event, Buffer.from(arrayBuffer), val.type);
      });
    }

    // Error
    if (val instanceof Error) {
      throw createError(val);
    }

    // Node.js Server Response (already handled with res.end())
    if (typeof val.end === "function") {
      return true;
    }
  }

  const valType = typeof val;

  // HTML String
  if (valType === "string") {
    return send(event, val, MIMES.html);
  }

  // JSON Response
  if (valType === "object" || valType === "boolean" || valType === "number") {
    return send(event, JSON.stringify(val, undefined, jsonSpace), MIMES.json);
  }

  // BigInt
  if (valType === "bigint") {
    return send(event, val.toString(), MIMES.json);
  }

  // Symbol or Function (undefined is already handled by consumer)
  throw createError({
    statusCode: 500,
    statusMessage: `[h3] Cannot send ${valType} as response.`,
  });
}

function cachedFn<T>(fn: () => T): () => T {
  let cache: T;
  return () => {
    if (!cache) {
      cache = fn();
    }
    return cache;
  };
}

function websocketOptions(
  evResolver: EventHandlerResolver,
  appOptions: AppOptions,
): WSOptions {
  return {
    ...appOptions.websocket,
    async resolve(request) {
      const { pathname } = parseURL(request.url || "/");
      const resolved = await evResolver(pathname);
      return resolved?.handler?.__websocket__ || {};
    },
  };
}
