import type {
  App,
  Stack,
  H3Event,
  EventHandler,
  EventHandlerResolver,
  LazyEventHandler,
  AppOptions,
  InputLayer,
  WebSocketOptions,
  Layer,
} from "./types";
import { _kRaw } from "./event";
import {
  defineLazyEventHandler,
  toEventHandler,
  isEventHandler,
  defineEventHandler,
} from "./handler";
import { createError } from "./error";
import {
  sendWebResponse,
  sendNoContent,
  defaultContentType,
} from "./utils/response";
import { isJSONSerializable } from "./utils/internal/object";
import {
  joinURL,
  getPathname,
  withoutTrailingSlash,
} from "./utils/internal/path";
import { MIMES } from "./utils/internal/consts";

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

  return defineEventHandler(async (event) => {
    // Keep a copy of incoming url
    const _reqPath = event[_kRaw].path || "/";

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
      event[_kRaw].path = _layerPath;

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
      if (event[_kRaw].handled) {
        if (options.onAfterResponse) {
          event._onAfterResponseCalled = true;
          await options.onAfterResponse(event, undefined);
        }
        return;
      }
    }

    if (!event[_kRaw].handled) {
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
    handler = defineLazyEventHandler(handler as LazyEventHandler);
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

  const valType = typeof val;

  // Undefined
  if (valType === "undefined") {
    return sendNoContent(event);
  }

  // Text
  if (valType === "string") {
    defaultContentType(event, MIMES.html);
    return event[_kRaw].sendResponse(val);
  }

  // Buffer (should be before JSON)
  if (val.buffer) {
    return event[_kRaw].sendResponse(val);
  }

  // Error (should be before JSON)
  if (val instanceof Error) {
    throw createError(val);
  }

  // JSON
  if (isJSONSerializable(val, valType)) {
    defaultContentType(event, MIMES.json);
    return event[_kRaw].sendResponse(JSON.stringify(val, undefined, jsonSpace));
  }

  // BigInt
  if (valType === "bigint") {
    defaultContentType(event, MIMES.json);
    return event[_kRaw].sendResponse(val.toString());
  }

  // Web Response
  if (val instanceof Response) {
    return sendWebResponse(event, val);
  }

  // Blob
  if (val.arrayBuffer && typeof val.arrayBuffer === "function") {
    return (val as Blob).arrayBuffer().then((arrayBuffer) => {
      defaultContentType(event, val.type);
      return event[_kRaw].sendResponse(Buffer.from(arrayBuffer));
    });
  }

  // Symbol or Function is not supported
  if (valType === "symbol" || valType === "function") {
    throw createError({
      statusCode: 500,
      statusMessage: `[h3] Cannot send ${valType} as response.`,
    });
  }

  // Other values: direct send
  return event[_kRaw].sendResponse(val);
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
): WebSocketOptions {
  return {
    ...appOptions.websocket,
    async resolve(info) {
      const pathname = getPathname(info.url || "/");
      const resolved = await evResolver(pathname);
      return resolved?.handler?.__websocket__ || {};
    },
  };
}
