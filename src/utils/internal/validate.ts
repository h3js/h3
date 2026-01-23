import { type ErrorDetails, HTTPError } from "../../error.ts";

import type { ServerRequest } from "srvx";
import type { StandardSchemaV1, FailureResult, InferOutput, Issue } from "./standard-schema.ts";

export type ValidateResult<T> = T | true | false | void;

export type ValidateFunction<T, Schema extends StandardSchemaV1 = StandardSchemaV1<any, T>> =
  | Schema
  | ((data: unknown) => ValidateResult<T> | Promise<ValidateResult<T>>);

export type ValidateIssues = ReadonlyArray<Issue>;

export type OnValidateError<Source extends string = string> = (
  result: FailureResult & { _source?: Source },
) => ErrorDetails;

const VALIDATION_FAILED = "Validation failed";

/**
 * Validates the given data using the provided validation function.
 * @template T The expected type of the validated data.
 * @param data The data to validate.
 * @param fn The validation schema or function to use - can be async.
 * @param error Optional error details or a function that returns error details if validation fails.
 * @returns A Promise that resolves with the validated data if it passes validation, meaning the validation function does not throw and returns a value other than false.
 * @throws {ValidationError} If the validation function returns false or throws an error.
 */
export async function validateData<Schema extends StandardSchemaV1>(
  data: unknown,
  fn: Schema,
  options?: { onError?: OnValidateError },
): Promise<InferOutput<Schema>>;
export async function validateData<T>(
  data: unknown,
  fn: (data: unknown) => ValidateResult<T> | Promise<ValidateResult<T>>,
  options?: { onError?: OnValidateError },
): Promise<T>;
export async function validateData<T>(
  data: unknown,
  fn: ValidateFunction<T>,
  options?: { onError?: OnValidateError },
): Promise<T> {
  if ("~standard" in fn) {
    const result = await fn["~standard"].validate(data);
    if (result.issues) {
      throw createValidationError(
        options?.onError?.(result) || {
          message: VALIDATION_FAILED,
          issues: result.issues,
        },
      );
    }
    return result.value;
  }

  try {
    const res = await fn(data);
    if (res === false) {
      throw createValidationError(
        options?.onError?.({
          issues: [{ message: VALIDATION_FAILED }],
        }) || { message: VALIDATION_FAILED },
      );
    }
    if (res === true) {
      return data as T;
    }
    return res ?? (data as T);
  } catch (error) {
    throw createValidationError(error as Error);
  }
}

// prettier-ignore
const reqBodyKeys = new Set(["body", "text", "formData", "arrayBuffer"]);

export function validatedRequest<
  RequestBody extends StandardSchemaV1,
  RequestHeaders extends StandardSchemaV1,
>(
  req: ServerRequest,
  validate: {
    body?: RequestBody;
    headers?: RequestHeaders;
    onError?: OnValidateError;
  },
): ServerRequest {
  // Validate Headers
  if (validate.headers) {
    const validatedheaders = syncValidate(
      "headers",
      Object.fromEntries(req.headers.entries()),
      validate.headers as StandardSchemaV1<Record<string, string>>,
      validate.onError,
    );
    for (const [key, value] of Object.entries(validatedheaders)) {
      req.headers.set(key, value);
    }
  }

  if (!validate.body) {
    return req;
  }

  // Create proxy for lazy body validation
  return new Proxy(req, {
    get(_target, prop: keyof ServerRequest) {
      if (validate.body) {
        if (prop === "json") {
          return function _validatedJson() {
            return req
              .json()
              .then((data) => validate.body!["~standard"].validate(data))
              .then((result) => {
                if (result.issues) {
                  throw createValidationError(
                    validate.onError?.({ _source: "body", ...result }) || {
                      message: VALIDATION_FAILED,
                      issues: result.issues,
                    },
                  );
                }

                return result.value;
              });
          };
        } else if (reqBodyKeys.has(prop)) {
          throw new TypeError(
            `Cannot access .${prop} on request with JSON validation enabled. Use .json() instead.`,
          );
        }
      }
      return Reflect.get(req, prop);
    },
  });
}

export function validatedURL(
  url: URL,
  validate: {
    query?: StandardSchemaV1;
    onError?: OnValidateError;
  },
): URL {
  if (!validate.query) {
    return url;
  }

  const validatedQuery = syncValidate(
    "query",
    Object.fromEntries(url.searchParams.entries()),
    validate.query as StandardSchemaV1<Record<string, string>>,
    validate.onError,
  );

  for (const [key, value] of Object.entries(validatedQuery)) {
    url.searchParams.set(key, value);
  }

  return url;
}

function syncValidate<Source extends "headers" | "query", T = unknown>(
  source: Source,
  data: unknown,
  fn: StandardSchemaV1<T>,
  onError?: OnValidateError,
): T {
  const result = fn["~standard"].validate(data);
  if (result instanceof Promise) {
    throw new TypeError(`Asynchronous validation is not supported for ${source}`);
  }
  if (result.issues) {
    throw createValidationError(
      onError?.({ _source: source, ...result }) || {
        message: VALIDATION_FAILED,
        issues: result.issues,
      },
    );
  }
  return result.value;
}

function createValidationError(cause: Error | HTTPError | ErrorDetails | FailureResult) {
  return HTTPError.isError(cause)
    ? cause
    : new HTTPError({
        cause,
        status: (cause as HTTPError)?.status || 400,
        statusText: (cause as HTTPError)?.statusText || VALIDATION_FAILED,
        message: (cause as HTTPError)?.message || VALIDATION_FAILED,
        data: {
          issues: (cause as FailureResult)?.issues,
          message:
            cause instanceof Error
              ? VALIDATION_FAILED
              : (cause as ErrorDetails)?.message || VALIDATION_FAILED,
        },
      });
}
