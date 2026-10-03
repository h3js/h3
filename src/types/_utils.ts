import type { InferRouteParams } from "rou3";

export type MaybePromise<T = unknown> = T | Promise<T>;

export type Simplify<T> = { [K in keyof T]: T[K] } & {};

type OptionalKeys<Params> = {
  [Key in keyof Params]-?: undefined extends Params[Key] ? Key : never;
}[keyof Params];

export type RouteParams<Route extends string> =
  InferRouteParams<Route> extends infer Params
    ? keyof Params extends never
      ? undefined
      :
          | Simplify<
              Omit<Params, OptionalKeys<Params>> & Partial<Pick<Params, OptionalKeys<Params>>>
            >
          | (keyof Params extends OptionalKeys<Params> ? undefined : never)
    : never;
