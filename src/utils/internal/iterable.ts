import { textEncoder } from "./encoding.ts";

export type IterationSource<TVal, TRet = TVal> =
  | Iterable<TVal>
  | AsyncIterable<TVal>
  | Iterator<TVal, TRet | undefined>
  | AsyncIterator<TVal, TRet | undefined>
  | (() => Iterator<TVal, TRet | undefined> | AsyncIterator<TVal, TRet | undefined>);

export type IteratorSerializer<TValue> = (value: TValue) => Uint8Array | undefined;

/**
 * The default implementation for {@link iterable}'s `serializer` argument.
 * It serializes values as follows:
 * - Instances of {@link String}, {@link Uint8Array} and `undefined` are returned as-is.
 * - Objects are serialized through {@link JSON.stringify}.
 * - Functions are serialized as `undefined`.
 * - Values of type boolean, number, bigint or symbol are serialized using their `toString` function.
 *
 * @param value - The value to serialize to either a string or Uint8Array.
 */
export function serializeIterableValue(value: unknown): Uint8Array {
  switch (typeof value) {
    case "string": {
      return textEncoder.encode(value);
    }
    case "boolean":
    case "number":
    case "bigint":
    case "symbol": {
      return textEncoder.encode(value.toString());
    }
    case "object": {
      if (value instanceof Uint8Array) {
        return value;
      }
      return textEncoder.encode(JSON.stringify(value));
    }
  }
  return new Uint8Array();
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
