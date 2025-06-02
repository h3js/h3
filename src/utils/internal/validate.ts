import { createError } from "../../error.ts";
import type { StandardSchemaV1 } from "./standard-schema.ts";

export type ValidateResult<T> = T | true | false | void;

export type ValidateFunction<T> =
  | StandardSchemaV1<T>
  | ((data: unknown) => ValidateResult<T> | Promise<ValidateResult<T>>);

/**
 * Validates the given data using the provided validation function.
 * @template T The expected type of the validated data.
 * @param data The data to validate.
 * @param fn The validation function to use - can be async.
 * @returns A Promise that resolves with the validated data if it passes validation, meaning the validation function does not throw and returns a value other than false.
 * @throws {ValidationError} If the validation function returns false or throws an error.
 */
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

function createValidationError(validateError?: any) {
  throw createError({
    status: 400,
    statusMessage: "Validation failed",
    message: validateError?.message || "Validation failed",
    data: validateError,
    cause: validateError,
  });
}
