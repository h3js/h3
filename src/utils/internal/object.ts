import { EmptyObject } from "./obj.ts";

/**
 * Checks if a certain input has a given property.
 * @param obj - The input to check.
 * @param prop - The property to check for.
 * @returns A boolean indicating whether the input is an object and has the property.
 */
export function hasProp(obj: any, prop: string | symbol) {
  try {
    return prop in obj;
  } catch {
    return false;
  }
}

export function isJSONSerializable(value: any, _type: string): boolean {
  // Primitive values are JSON serializable
  if (value === null || value === undefined) {
    return true;
  }
  if (_type !== "object") {
    return _type === "boolean" || _type === "number" || _type === "string";
  }

  // Objects with `toJSON` are JSON serializable
  if (typeof value.toJSON === "function") {
    return true;
  }

  // Arrays are JSON serializable (we assume items are safe too!)
  if (Array.isArray(value)) {
    return true;
  }

  // Pipable streams are not JSON serializable (react pipe result is pure object :()
  if (typeof value.pipe === "function" || typeof value.pipeTo === "function") {
    return false;
  }

  // H3 empty object
  if (value instanceof EmptyObject) {
    return true;
  }

  // Pure object
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
