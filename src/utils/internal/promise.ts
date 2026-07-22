/**
 * Continue with `fn` once `value` settles, staying synchronous when it already is.
 *
 * Avoids the `async`/`await` microtask tick on the common sync path while
 * collapsing the repeated thenable check into one shared helper. Duck-types
 * `then` (instead of `instanceof Promise`) to support cross-realm promises
 * and custom thenables.
 */
export function chain<T, R>(value: T | PromiseLike<T>, fn: (value: T) => R): R | Promise<R> {
  return typeof (value as PromiseLike<T>)?.then === "function"
    ? ((value as PromiseLike<T>).then(fn) as Promise<R>)
    : fn(value as T);
}
