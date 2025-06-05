import { sanitizeStatusMessage, sanitizeStatusCode } from "./utils/sanitize.ts";

/**
 * Raw object describing HTTP error (passed to `HTTPError` constructor).
 */
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  /**
   * Original error object that caused this error.
   */
  cause?: unknown;

  /**
   * Additional HTTP headers to be sent in error response.
   */
  headers?: HeadersInit;

  /**
   * @deprecated use `status`
   */
  statusCode?: number;

  /**
   * @deprecated use `statusText`
   */
  statusMessage?: string;
}

export type ErrorDetails =
  | (Error & { cause?: unknown })
  | HTTPError
  | ErrorInput;

export interface ErrorBody<DataT = unknown> {
  /**
   * HTTP status code in range [200...599]
   */
  status: number;

  /**
   * HTTP status text
   *
   * **NOTE:** This should be short (max 512 to 1024 characters).
   * Allowed characters are tabs, spaces, visible ASCII characters, and extended characters (byte value 128–255).
   *
   * **TIP:** Use `message` for longer error descriptions in JSON body.
   */
  statusText?: string;

  /**
   * HTTP Error message.
   *
   * **NOTE:** This message will be in JSON body under `message` key.
   */
  message: string;

  /**
   * Flag to indicate that the error was not handled by the application.
   *
   * Unhandled error stack trace, data and message are hidden in non debug mode for security reasons.
   */
  unhandled?: boolean;

  /**
   * Additional data to attach in the error JSON body under `data` key.
   */
  data?: DataT;
}

/**
 * HTTPError
 */
export class HTTPError<DataT = unknown>
  extends Error
  implements ErrorBody<DataT>
{
  /**
   * HTTP status code in range [200...599]
   */
  status: number;

  /**
   * HTTP status text
   *
   * **NOTE:** This should be short (max 512 to 1024 characters).
   * Allowed characters are tabs, spaces, visible ASCII characters, and extended characters (byte value 128–255).
   *
   * **TIP:** Use `message` for longer error descriptions in JSON body.
   */
  statusText: string | undefined;

  /**
   * Additional HTTP headers to be sent in error response.
   */
  headers: Headers | undefined;

  /**
   * Original error object that caused this error.
   */
  cause: unknown | undefined;

  /**
   * Additional data to attach in the error JSON body under `data` key.
   */
  data: DataT | undefined;

  /**
   * Flag to indicate that the error was not handled by the application.
   *
   * Unhandled error stack trace, data and message are hidden in non debug mode for security reasons.
   */
  unhandled: boolean | undefined;

  /**
   * Check if the input is an instance of HTTPError using its constructor name.
   *
   * It is safer than using `instanceof` because it works across different contexts (e.g., if the error was thrown in a different module).
   */
  static isError(input: any): input is HTTPError {
    return input?.constructor?.name === "HTTPError";
  }

  /**
   * Create a new HTTPError with the given status code and optional status text and details.
   *
   * @example
   *
   * HTTPError.status(404)
   * HTTPError.status(418, "I'm a teapot")
   * HTTPError.status(403, "Forbidden", { message: "Not authenticated" })
   */
  static status(
    status: number,
    statusText?: string,
    details?: Exclude<
      ErrorDetails,
      "status" | "statusText" | "statusCode" | "statusMessage"
    >,
  ): HTTPError {
    return new HTTPError({ ...details, statusText, status });
  }

  /**
   * Create a new HTTPError with the given message and optional details.
   *
   * @example
   *
   * new HTTPError("This is an error", { status: 400, cause: error })
   * new HTTPError({ message: "This is an error", status: 500, statusText: "Not Found", data: {} })
   */
  constructor(message: string, details?: ErrorDetails);
  constructor(details: ErrorDetails);
  constructor(arg1: string | ErrorDetails, arg2?: ErrorDetails) {
    let messageInput: string | undefined;
    let details: ErrorDetails | undefined;
    if (typeof arg1 === "string") {
      messageInput = arg1;
      details = arg2;
    } else {
      details = arg1;
    }

    const status = sanitizeStatusCode(
      (details as ErrorBody)?.status ||
        (details?.cause as ErrorBody)?.status ||
        (details as ErrorBody)?.status ||
        (details as ErrorInput)?.statusCode,
      500,
    );

    const stautText = sanitizeStatusMessage(
      (details as ErrorBody)?.statusText ||
        (details?.cause as ErrorBody)?.statusText ||
        (details as ErrorBody)?.statusText ||
        (details as ErrorInput)?.statusMessage,
    );

    const message: string =
      messageInput ||
      details?.message ||
      (details?.cause as ErrorDetails)?.message ||
      (details as ErrorBody)?.statusText ||
      (details as ErrorInput)?.statusMessage ||
      ["HTTPError", status, stautText].filter(Boolean).join(" ");

    // @ts-ignore https://v8.dev/features/error-cause
    super(message, { cause: details });
    this.cause = details;
    Error.captureStackTrace?.(this, this.constructor);

    this.status = status;
    this.statusText = stautText || undefined;

    const rawHeaders =
      (details as ErrorInput)?.headers ||
      (details?.cause as ErrorInput)?.headers;
    this.headers = rawHeaders ? new Headers(rawHeaders) : undefined;

    this.unhandled =
      (details as ErrorBody)?.unhandled ??
      (details?.cause as ErrorBody)?.unhandled ??
      undefined;

    this.data = (details as ErrorBody)?.data as DataT | undefined;
  }

  /**
   * @deprecated Use `status`
   */
  get statusCode(): number {
    return this.status;
  }

  /**
   * @deprecated Use `statusText`
   */
  get statusMessage(): string | undefined {
    return this.statusText;
  }

  toJSON(): ErrorBody {
    return {
      status: this.status,
      statusText: this.statusText,
      message: this.message,
      unhandled: this.unhandled,
      data: this.data,
    };
  }
}
