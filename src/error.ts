import { hasProp } from "./utils/internal/object.ts";
import { sanitizeStatusMessage, sanitizeStatusCode } from "./utils/sanitize.ts";

/**
 * H3 Runtime Error
 * @class
 * @extends Error
 * @property {number} statusCode - An integer indicating the HTTP response status code.
 * @property {string} statusMessage - A string representing the HTTP status message.
 * @property {boolean} fatal - Indicates if the error is a fatal error.
 * @property {boolean} unhandled - Indicates if the error was unhandled and auto-captured.
 * @property {DataT} data - An extra data that will be included in the response.
 *                         This can be used to pass additional information about the error.
 */
export class H3Error<DataT = unknown> extends Error {
  static __h3_error__ = true;
  statusCode = 500;
  fatal = false;
  unhandled = false;
  statusMessage?: string;
  data?: DataT;
  cause?: unknown;
  headers?: HeadersInit;

  constructor(message: string, opts: { cause?: unknown } = {}) {
    // @ts-ignore https://v8.dev/features/error-cause
    super(message, opts);

    // Polyfill cause for other runtimes
    if (opts.cause && !this.cause) {
      this.cause = opts.cause;
    }
  }

  toJSON(): Pick<
    H3Error<DataT>,
    "message" | "statusCode" | "statusMessage" | "data"
  > {
    const obj: Pick<
      H3Error<DataT>,
      "message" | "statusCode" | "statusMessage" | "data"
    > = {
      message: this.message,
      statusCode: sanitizeStatusCode(this.statusCode, 500),
    };

    if (this.statusMessage) {
      obj.statusMessage = sanitizeStatusMessage(this.statusMessage);
    }
    if (this.data !== undefined) {
      obj.data = this.data;
    }

    return obj;
  }
}

/**
 * Creates a new `Error` that can be used to handle both internal and runtime errors.
 *
 * @param input {string | (Partial<H3Error> & { status?: number; statusText?: string })} - The error message or an object containing error properties.
 * If a string is provided, it will be used as the error `message`.
 *
 * @example
 * // String error where `statusCode` defaults to `500`
 * throw createError("An error occurred");
 * // Object error
 * throw createError({
 *   statusCode: 400,
 *   statusMessage: "Bad Request",
 *   message: "Invalid input",
 *   data: { field: "email" }
 * });
 *
 *
 * @return {H3Error} - An instance of H3Error.
 *
 * @remarks
 * - Typically, `message` contains a brief, human-readable description of the error, while `statusMessage` is specific to HTTP responses and describes
 * the status text related to the response status code.
 * - In a client-server context, using a short `statusMessage` is recommended because it can be accessed on the client side. Otherwise, a `message`
 * passed to `createError` on the server will not propagate to the client.
 * - Consider avoiding putting dynamic user input in the `message` to prevent potential security issues.
 */
export function createError<DataT = unknown>(
  input:
    | string
    | (Partial<H3Error<DataT>> & {
        status?: number;
        statusText?: string;
        headers?: HeadersInit;
      }),
): H3Error<DataT> {
  if (typeof input === "string") {
    return new H3Error<DataT>(input);
  }

  // Inherit H3Error properties from cause as fallback
  const cause: unknown = input.cause;

  const err = new H3Error<DataT>(input.message ?? input.statusMessage ?? "", {
    cause: cause || input,
  });

  if (hasProp(input, "stack")) {
    try {
      Object.defineProperty(err, "stack", {
        get() {
          return input.stack;
        },
      });
    } catch {
      try {
        err.stack = input.stack;
      } catch {
        // Ignore
      }
    }
  }

  if (input.data) {
    err.data = input.data;
  }

  const statusCode =
    input.statusCode ??
    input.status ??
    (cause as H3Error)?.statusCode ??
    (cause as { status?: number })?.status;
  if (typeof statusCode === "number") {
    err.statusCode = sanitizeStatusCode(statusCode);
  }

  const statusMessage =
    input.statusMessage ??
    input.statusText ??
    (cause as H3Error)?.statusMessage ??
    (cause as { statusText?: string })?.statusText;
  if (statusMessage) {
    err.statusMessage = sanitizeStatusMessage(statusMessage);
  }

  const fatal = input.fatal ?? (cause as H3Error)?.fatal;
  if (fatal !== undefined) {
    err.fatal = fatal;
  }

  const unhandled = input.unhandled ?? (cause as H3Error)?.unhandled;
  if (unhandled !== undefined) {
    err.unhandled = unhandled;
  }

  if (input.headers) {
    err.headers = new Headers(input.headers);
  }

  return err;
}

/**
 * Checks if the given input is an instance of H3Error.
 *
 * @param input {*} - The input to check.
 * @return {boolean} - Returns true if the input is an instance of H3Error, false otherwise.
 */
export function isError<DataT = unknown>(input: any): input is H3Error<DataT> {
  return input?.constructor?.__h3_error__ === true;
}
