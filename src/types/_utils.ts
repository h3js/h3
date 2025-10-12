export type MaybePromise<T = unknown> = T | Promise<T>;

export type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type RouteParams<T> =
  Simplify<T> extends infer _Simplified
    ? keyof _Simplified extends never
      ? undefined
      : _Simplified
    : never;
