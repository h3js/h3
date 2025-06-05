import { sanitizeStatusMessage, sanitizeStatusCode } from "./utils/sanitize.ts";

/**
 * H3 Runtime Error
 */
export class HTTPError<
    DataT extends Record<string, unknown> = Record<string, unknown>,
  >
  extends Error
  implements ErrorObject<DataT>
{
  status: number;
  statusText: string | undefined;
  headers: Headers | undefined;
  cause: unknown | undefined;
  data: DataT | undefined;

  unhandled?: boolean;

  static isError(input: any): input is HTTPError {
    return input?.constructor?.name === "HTTPError";
  }

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

  constructor(message: string, details?: ErrorDetails);
  constructor(details: ErrorDetails);
  constructor(arg1: string | ErrorDetails, arg2?: ErrorDetails) {
    let statusInput: number | undefined;
    let messageInput: string | undefined;
    let details: ErrorDetails | undefined;
    if (typeof arg1 === "string") {
      messageInput = arg1;
      details = arg2;
    } else {
      details = arg1;
    }

    const status = sanitizeStatusCode(
      statusInput ||
        (details as ErrorObject)?.status ||
        (details?.cause as ErrorObject)?.status ||
        (details as ErrorObject)?.status ||
        (details as ErrorObjectInput)?.statusCode,
      500,
    );

    const stautText = sanitizeStatusMessage(
      (details as ErrorObject)?.statusText ||
        (details?.cause as ErrorObject)?.statusText ||
        (details as ErrorObject)?.statusText ||
        (details as ErrorObjectInput)?.statusMessage,
    );

    const message: string =
      messageInput ||
      details?.message ||
      (details?.cause as ErrorDetails)?.message ||
      (details as ErrorObject)?.statusText ||
      (details as ErrorObjectInput)?.statusMessage ||
      ["HTTPError", status, stautText].filter(Boolean).join(" ");

    // @ts-ignore https://v8.dev/features/error-cause
    super(message, { cause: details });
    this.cause = details;
    Error.captureStackTrace?.(this, this.constructor);

    this.status = status;
    this.statusText = stautText || undefined;

    const rawHeaders =
      (details as ErrorObjectInput)?.headers ||
      (details?.cause as ErrorObjectInput)?.headers;
    this.headers = rawHeaders ? new Headers(rawHeaders) : undefined;

    this.unhandled =
      (details as ErrorObject)?.unhandled ??
      (details?.cause as ErrorObject)?.unhandled ??
      false;

    this.data = (details as ErrorObject)?.data as DataT | undefined;
  }

  /** @deprecated Use `status` */
  get statusCode(): number {
    return this.status;
  }

  /** @deprecated Use `statusText` */
  get statusMessage(): string | undefined {
    return this.statusText;
  }

  toJSON(): ErrorObject {
    return {
      status: this.status,
      statusText: this.statusText,
      message: this.message,
      unhandled: this.unhandled,
      data: this.data,
    };
  }
}

// ---- Types ----

export type ErrorDetails =
  | (Error & { cause?: unknown })
  | HTTPError
  | ErrorObjectInput;

export interface ErrorObject<
  DataT extends Record<string, unknown> = Record<string, unknown>,
> {
  status: number;
  statusText?: string;
  message: string;
  unhandled?: boolean;
  data?: DataT;
}

export interface ErrorObjectInput<
  DataT extends Record<string, unknown> = Record<string, unknown>,
> extends Partial<ErrorObject<DataT>> {
  cause?: unknown;
  headers?: HeadersInit;

  /** @deprecated use `status` */
  statusCode?: number;

  /** @deprecated use `statusText` */
  statusMessage?: string;
}
