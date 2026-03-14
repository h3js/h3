export type MaybePromise<T = unknown> = T | Promise<T>;

/**
 * Extract route parameter names from a route path string.
 *
 * @example
 * ```ts
 * type Params = ExtractRouteParams<"/users/:id/posts/:slug">;
 * // { id: string; slug: string }
 * ```
 */
export type ExtractRouteParams<T extends string> = _Prettify<_ExtractParams<T>>;

type _ExtractParams<T extends string> = string extends T
  ? Record<string, string>
  : T extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param]: string } & _ExtractParams<Rest>
    : T extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : Record<string, string>;

type _Prettify<T> = { [K in keyof T]: T[K] } & {};
