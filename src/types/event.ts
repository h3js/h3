import type { ServerRequest } from "srvx";
import type { Session } from "../utils/session.ts";
import type { H3Route } from "./h3.ts";
import type { TypedRequest } from "fetchdts";
import type { EventHandlerRequest } from "./handler.ts";

export declare class H3Event<
  _RequestT extends EventHandlerRequest = EventHandlerRequest,
> {
  /**
   * Event context.
   */
  readonly context: H3EventContext;

  /**
   * Incoming HTTP request info.
   *
   * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/Request)
   */
  readonly req: Omit<ServerRequest, "json" | "headers" | "clone"> &
    Pick<
      TypedRequest<NonNullable<_RequestT["body"]>, Record<string, string>>,
      "json" | "headers" | "clone"
    >;

  /**
   * Access to the parsed request URL.
   *
   * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/URL)
   */
  readonly url: URL;

  /**
   * Prepared HTTP response.
   */
  readonly res: {
    status?: number;
    statusText?: string;
    readonly headers: Headers;
  };

  /**
   * Access to runtime specific additional context.
   *
   */
  runtime: ServerRequest["runtime"];

  /**
   * Tell the runtime about an ongoing operation that shouldn't close until the promise resolves.
   */
  waitUntil: (promise: Promise<any>) => void;

  /**
   * Access to the raw Node.js req/res objects.
   *
   * @deprecated Use `event.runtime.{node|deno|bun|...}.` instead.
   */
  node: NonNullable<ServerRequest["runtime"]>["node"] | undefined;

  /**
   * Access to the incoming request url (pathname+search).
   *
   * @deprecated Use `event.url` instead.
   *
   * Example: `/api/hello?name=world`
   * */
  readonly path: string;

  /**
   * Access to the incoming request method.
   *
   * @deprecated Use `event.req.method` instead.
   */
  readonly method: string;

  /**
   * Access to the incoming request headers.
   *
   * @deprecated Use `event.req.headers` instead.
   *
   * */
  readonly headers: Headers;

  toJSON(): string;
  toString(): string;
}

export interface H3EventContext extends Record<string, any> {
  /* Matched router parameters */
  params?: Record<string, string>;

  /* Matched middleware parameters */
  middlewareParams?: Record<string, string>;

  /**
   * Matched router Node
   *
   * @experimental The object structure may change in non-major version.
   */
  matchedRoute?: H3Route;

  /* Cached session data */
  sessions?: Record<string, Session>;

  /* Trusted IP Address of client */
  clientAddress?: string;

  /* Basic authentication data */
  basicAuth?: {
    username?: string;
    password?: string;
    realm?: string;
  };
}
