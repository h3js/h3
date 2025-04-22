import { createError } from "../../error.ts";

export type ValidateResult<T> = T | true | false | void;

export type ValidateFunction<T> = (
  data: unknown,
) => ValidateResult<T> | Promise<ValidateResult<T>>;

// TODO: Consider using similar method of typeschema for external library compatibility
// https://github.com/decs/typeschema/blob/v0.1.3/src/assert.ts

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
  try {
    const res = await fn(data);
    if (res === false) {
      throw createValidationError();
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
    statusMessage: "Validation Error",
    message: validateError?.message || "Validation Error",
    data: validateError,
    cause: validateError,
  });
}
