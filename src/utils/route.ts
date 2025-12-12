import type { H3RouteMeta, HTTPMethod } from "../types/h3.ts";
import type { EventHandlerRequest, Middleware } from "../types/handler.ts";
import type { H3Plugin, H3 } from "../types/h3.ts";
import type { H3Event } from "../event.ts";
import type {
  StandardSchemaV1,
  InferOutput,
} from "./internal/standard-schema.ts";
import { defineValidatedHandler } from "../handler.ts";

type StringHeaders<T> = {
  [K in keyof T]: Extract<T[K], string>;
};

/**
 * Route validation schemas
 */
export interface RouteValidation {
  body?: StandardSchemaV1;
  headers?: StandardSchemaV1;
  query?: StandardSchemaV1;
  params?: StandardSchemaV1;
  response?: StandardSchemaV1;
}

/**
 * Route definition options with type-safe validation
 */
export interface RouteDefinition<V extends RouteValidation = RouteValidation> {
  /**
   * HTTP method for the route, e.g. 'GET', 'POST', etc.
   */
  method: HTTPMethod;

  /**
   * Route pattern, e.g. '/api/users/:id'
   */
  route: string;

  /**
   * Handler function for the route.
   */
  handler: (
    event: H3Event<
      EventHandlerRequest & {
        body: V["body"] extends StandardSchemaV1
          ? InferOutput<V["body"]>
          : unknown;
        query: V["query"] extends StandardSchemaV1
          ? StringHeaders<InferOutput<V["query"]>>
          : Partial<Record<string, string>>;
        routerParams: V["params"] extends StandardSchemaV1
          ? InferOutput<V["params"]>
          : Record<string, string>;
      }
    >,
  ) =>
    | (V["response"] extends StandardSchemaV1
        ? InferOutput<V["response"]>
        : unknown)
    | Promise<
        V["response"] extends StandardSchemaV1
          ? InferOutput<V["response"]>
          : unknown
      >;

  /**
   * Optional middleware to run before the handler.
   */
  middleware?: Middleware[];

  /**
   * Additional route metadata.
   */
  meta?: H3RouteMeta;

  /**
   * Validation schemas for request and response
   */
  validate?: V;
}

// Helper type for validated H3Event with typed context.params
type ValidatedRouteEvent<RequestT extends EventHandlerRequest, ParamsT> = Omit<
  H3Event<RequestT>,
  "context"
> & {
  context: Omit<H3Event["context"], "params"> & {
    params?: ParamsT;
  };
};

// Overload: With validation (any combination of validation schemas)
export function defineRoute<
  Body extends StandardSchemaV1 = never,
  Headers extends StandardSchemaV1 = never,
  Query extends StandardSchemaV1 = never,
  Params extends StandardSchemaV1 = never,
  Response extends StandardSchemaV1 = never,
>(def: {
  method: HTTPMethod;
  route: string;
  validate: {
    body?: Body;
    headers?: Headers;
    query?: Query;
    params?: Params;
    response?: Response;
  };
  handler: (
    event: ValidatedRouteEvent<
      EventHandlerRequest & {
        body: [Body] extends [never] ? unknown : InferOutput<Body>;
        query: [Query] extends [never]
          ? Partial<Record<string, string>>
          : StringHeaders<InferOutput<Query>>;
        routerParams: [Params] extends [never]
          ? Record<string, string>
          : InferOutput<Params>;
      },
      [Params] extends [never] ? Record<string, string> : InferOutput<Params>
    >,
  ) =>
    | ([Response] extends [never] ? unknown : InferOutput<Response>)
    | Promise<[Response] extends [never] ? unknown : InferOutput<Response>>;
  middleware?: Middleware[];
  meta?: H3RouteMeta;
}): H3Plugin;

// Overload: Without validation
export function defineRoute(def: {
  method: HTTPMethod;
  route: string;
  handler: (event: H3Event) => unknown | Promise<unknown>;
  middleware?: Middleware[];
  meta?: H3RouteMeta;
  validate?: never;
}): H3Plugin;

/**
 * Define a route as a plugin that can be registered with app.register()
 *
 * Routes defined with this function automatically get type-safe validation
 * for params, query, body, and response based on the provided schemas.
 *
 * @example
 * ```js
 * import { z } from "zod";
 *
 * const userRoute = defineRoute({
 *    method: 'POST',
 *    route: '/api/users/:id',
 *    validate: {
 *      params: z.object({ id: z.string().uuid() }),
 *      query: z.object({ include: z.string().optional() }),
 *      body: z.object({ name: z.string() }),
 *      response: z.object({ id: z.string(), name: z.string() }),
 *    },
 *    handler: (event) => {
 *      // event.context.params, await event.req.json(), and return value are all typed!
 *      const { id } = event.context.params;
 *      const body = await event.req.json();
 *      return { id, name: body.name };
 *    }
 * });
 *
 * app.use(userRoute);
 * ```
 */
export function defineRoute<V extends RouteValidation>(
  def: RouteDefinition<V>,
): H3Plugin {
  // TypeScript cannot infer complex conditional types between RouteDefinition and
  // defineValidatedHandler parameters. Runtime types are identical and safe.
  type ValidatedHandlerParam = Parameters<typeof defineValidatedHandler>[0];

  const handler = defineValidatedHandler(
    def as unknown as ValidatedHandlerParam,
  );

  return (h3: H3) => {
    h3.on(def.method, def.route, handler);
  };
}
