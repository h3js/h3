/**
 * Continue with `fn` once `value` settles, staying synchronous when it already is.
 *
 * Avoids the `async`/`await` microtask tick on the common sync path while
 * collapsing the repeated `instanceof Promise` branch into one shared helper.
 */
export function chain<T, R>(value: T | Promise<T>, fn: (value: T) => R): R | Promise<R> {
  return value instanceof Promise ? value.then(fn) : fn(value);
}
