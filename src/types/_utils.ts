import type { InferRouteParams } from "rou3";

export type MaybePromise<T = unknown> = T | Promise<T>;

export type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type RouteParams<T extends string> =
  Simplify<InferRouteParams<T>> extends infer _Simplified
    ? keyof _Simplified extends never
      ? undefined
      : _Simplified
    : never;
