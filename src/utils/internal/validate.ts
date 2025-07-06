import { type ErrorDetails, HTTPError } from "../../error.ts";

import type { ServerRequest } from "srvx";
import type {
  StandardSchemaV1,
  InferOutput,
  Issue,
} from "./standard-schema.ts";

export type ValidateResult<T> = T | true | false | void;

export type ValidateFunction<
  T,
  Schema extends StandardSchemaV1 = StandardSchemaV1<any, T>,
> =
  | Schema
  | ((data: unknown) => ValidateResult<T> | Promise<ValidateResult<T>>);

export type ValidateIssues = ReadonlyArray<Issue>;
export type ValidateError =
  | (() => ErrorDetails)
  | ((issues: ValidateIssues) => ErrorDetails);

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
  options?: {
    onError?: (issues: ValidateIssues) => ErrorDetails;
  },
): Promise<InferOutput<Schema>>;
export async function validateData<T>(
  data: unknown,
  fn: (data: unknown) => ValidateResult<T> | Promise<ValidateResult<T>>,
  options?: {
    onError?: () => ErrorDetails;
  },
): Promise<T>;
export async function validateData<T>(
  data: unknown,
  fn: ValidateFunction<T>,
  options?: {
    onError?: ValidateError;
  },
): Promise<T> {
  if ("~standard" in fn) {
    const result = await fn["~standard"].validate(data);
    if (result.issues) {
      const errorDetails = options?.onError
        ? options.onError(result.issues)
        : {
            message: "Validation failed",
            issues: result.issues,
          };

      throw createValidationError(errorDetails);
    }
    return result.value;
  }

  try {
    const res = await fn(data);
    if (res === false) {
      const errorDetails = options?.onError
        ? (options.onError as () => ErrorDetails)()
        : {
            message: "Validation failed",
          };

      throw createValidationError(errorDetails);
    }
    if (res === true) {
      return data as T;
    }
    return res ?? (data as T);
  } catch (error) {
    throw createValidationError(error);
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
    onValidationError?: (
      issues: ValidateIssues,
      source: "headers" | "body",
    ) => ErrorDetails;
  },
): ServerRequest {
  // Validate Headers
  if (validate.headers) {
    const validatedheaders = syncValidate(
      "headers",
      Object.fromEntries(req.headers.entries()),
      validate.headers as StandardSchemaV1<Record<string, string>>,
      validators.onValidationError,
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
          return () =>
            req
              .json()
              .then((data) => validate.body!["~standard"].validate(data))
              .then((result) =>
                if (result.issues) {
                  const errorDetails = validators.onValidationError
                    ? validators.onValidationError(result.issues, "body")
                    : {
                        message: "Validation failed",
                        issues: result.issues,
                      };

                  throw createValidationError(errorDetails);
                }

                return result.value;
              );
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
    onValidationError?: (
      issues: ValidateIssues,
      source: "query",
    ) => ErrorDetails;
  },
): URL {
  if (!validate.query) {
    return url;
  }

  const validatedQuery = syncValidate(
    "query",
    Object.fromEntries(url.searchParams.entries()),
    validate.query as StandardSchemaV1<Record<string, string>>,
    validators.onValidationError,
  );

  for (const [key, value] of Object.entries(validatedQuery)) {
    url.searchParams.set(key, value);
  }

  return url;
}

function syncValidate<Source extends "headers" | "query", T = unknown>(
  type: Source,
  data: unknown,
  fn: StandardSchemaV1<T>,
  error?: (issues: ValidateIssues, source: Source) => ErrorDetails,
): T {
  const result = fn["~standard"].validate(data);
  if (result instanceof Promise) {
    throw new TypeError(`Asynchronous validation is not supported for ${type}`);
  }
  if (result.issues) {
    const errorDetails = error
      ? error(result.issues, type)
      : {
          message: "Validation failed",
          issues: result.issues,
        };

    throw createValidationError(errorDetails);
  }
  return result.value;
}

function createValidationError(validateError?: HTTPError | any) {
  return HTTPError.isError(validateError)
    ? validateError
    : new HTTPError({
        status: validateError?.status || 400,
        statusText: validateError?.statusText || "Validation failed",
        message: validateError?.message,
        data: validateError,
        cause: validateError,
      });
}
