import { HTTPError } from "../../error.ts";

import type { ServerRequest } from "srvx";
import type { StandardSchemaV1, InferOutput } from "./standard-schema.ts";

export type ValidateResult<T> = T | true | false | void;

export type ValidateFunction<
  T,
  Schema extends StandardSchemaV1 = StandardSchemaV1<any, T>,
> =
  | Schema
  | ((data: unknown) => ValidateResult<T> | Promise<ValidateResult<T>>);

/**
 * Validates the given data using the provided validation function.
 * @template T The expected type of the validated data.
 * @param data The data to validate.
 * @param fn The validation schema or function to use - can be async.
 * @returns A Promise that resolves with the validated data if it passes validation, meaning the validation function does not throw and returns a value other than false.
 * @throws {ValidationError} If the validation function returns false or throws an error.
 */
export async function validateData<Schema extends StandardSchemaV1>(
  data: unknown,
  fn: Schema,
): Promise<InferOutput<Schema>>;
export async function validateData<T>(
  data: unknown,
  fn: (data: unknown) => ValidateResult<T> | Promise<ValidateResult<T>>,
): Promise<T>;
export async function validateData<T>(
  data: unknown,
  fn: ValidateFunction<T>,
): Promise<T> {
  if ("~standard" in fn) {
    const result = await fn["~standard"].validate(data);
    if (result.issues) {
      throw createValidationError({
        message: "Validation failed",
        issues: result.issues,
      });
    }
    return result.value;
  }

  try {
    const res = await fn(data);
    if (res === false) {
      throw createValidationError({ message: "Validation failed" });
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
  validators: {
    body?: RequestBody;
    headers?: RequestHeaders;
  },
): ServerRequest {
  // Validate Headers
  if (validators.headers) {
    const validatedheaders = syncValidate(
      "headers",
      Object.fromEntries(req.headers.entries()),
      validators.headers as StandardSchemaV1<Record<string, string>>,
    );
    for (const [key, value] of Object.entries(validatedheaders)) {
      req.headers.set(key, value);
    }
  }

  if (!validators.body) {
    return req;
  }

  // Create proxy for lazy body validation
  return new Proxy(req, {
    get(_target, prop: keyof ServerRequest) {
      if (validators.body) {
        if (prop === "json") {
          return () =>
            req
              .json()
              .then((data) => validators.body!["~standard"].validate(data))
              .then((result) =>
                result.issues
                  ? Promise.reject(createValidationError(result))
                  : result.value,
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
  validators: {
    query?: StandardSchemaV1;
  },
): URL {
  if (!validators.query) {
    return url;
  }

  const validatedQuery = syncValidate(
    "query",
    Object.fromEntries(url.searchParams.entries()),
    validators.query as StandardSchemaV1<Record<string, string>>,
  );

  for (const [key, value] of Object.entries(validatedQuery)) {
    url.searchParams.set(key, value);
  }

  return url;
}

function syncValidate<T = unknown>(
  type: string,
  data: unknown,
  fn: StandardSchemaV1<T>,
): T {
  const result = fn["~standard"].validate(data);
  if (result instanceof Promise) {
    throw new TypeError(`Asynchronous validation is not supported for ${type}`);
  }
  if (result.issues) {
    throw createValidationError({
      issues: result.issues,
    });
  }
  return result.value;
}

function createValidationError(validateError?: any) {
  return new HTTPError({
    status: 400,
    statusText: "Validation failed",
    message: validateError?.message,
    data: validateError,
    cause: validateError,
  });
}
