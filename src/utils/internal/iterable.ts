export type IterationSource<Val, Ret = Val> =
  | Iterable<Val>
  | AsyncIterable<Val>
  | Iterator<Val, Ret | undefined>
  | AsyncIterator<Val, Ret | undefined>
  | (() =>
      Iterator<Val, Ret | undefined> | AsyncIterator<Val, Ret | undefined>);

type SendableValue = string | Buffer | Uint8Array;
export type IteratorSerializer<Value> = (
  value: Value,
) => SendableValue | undefined;

/**
 * The default implementation for {@link sendIterable}'s `serializer` argument.
 * It serializes values as follows:
 * - Instances of {@link String}, {@link Uint8Array} and `undefined` are returned as-is.
 * - Objects are serialized through {@link JSON.stringify}.
 * - Functions are serialized as `undefined`.
 * - Values of type boolean, number, bigint or symbol are serialized using their `toString` function.
 *
 * @param value - The value to serialize to either a string or Uint8Array.
 */
export function serializeIterableValue(
  value: unknown,
): SendableValue | undefined {
  switch (typeof value) {
    case "string": {
      return value;
    }
    case "boolean":
    case "number":
    case "bigint":
    case "symbol": {
      return value.toString();
    }
    case "function":
    case "undefined": {
      return undefined;
    }
    case "object": {
      if (value instanceof Uint8Array) {
        return value;
      }
      return JSON.stringify(value);
    }
  }
}

export function coerceIterable<V, R>(
  iterable: IterationSource<V, R>,
): Iterator<V> | AsyncIterator<V> {
  if (typeof iterable === "function") {
    iterable = iterable();
  }
  if (Symbol.iterator in iterable) {
    return iterable[Symbol.iterator]();
  }
  if (Symbol.asyncIterator in iterable) {
    return iterable[Symbol.asyncIterator]();
  }
  return iterable;
}
