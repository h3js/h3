/**
Based on https://github.com/anonrig/fast-querystring/commit/9dcbaf
Copyright (c) 2022 Yagiz Nizipli
https://github.com/anonrig/fast-querystring/blob/main/LICENSE
*/

import { EmptyObject } from "./obj.ts";

const plusRegex = /\+/g;

export function parseQuery(input: string): Record<string, string | string[]> {
  const params = new EmptyObject();
  if (!input || input === "?") {
    return params;
  }
  const inputLength = input.length;

  let key = "";
  let value = "";
  let startingIndex = -1;
  let equalityIndex = -1;
  let shouldDecodeKey = false;
  let shouldDecodeValue = false;
  let keyHasPlus = false;
  let valueHasPlus = false;
  let hasBothKeyValuePair = false;
  let c = 0;

  // Have a boundary of input.length + 1 to access last pair inside the loop.
  for (let i = 0; i < inputLength + 1; i++) {
    c = i === inputLength ? 38 /* & */ : input.charCodeAt(i);

    // Handle '&' and end of line to pass the current values to result
    switch (c) {
      case 38 /* & */: {
        hasBothKeyValuePair = equalityIndex > startingIndex;

        // Optimization: Reuse equality index to store the end of key
        if (!hasBothKeyValuePair) {
          equalityIndex = i;
        }

        key = input.slice(startingIndex + 1, equalityIndex);

        // Add key/value pair only if the range size is greater than 1; a.k.a. contains at least "="
        if (hasBothKeyValuePair || key.length > 0) {
          // Optimization: Replace '+' with space
          if (keyHasPlus) {
            key = key.replace(plusRegex, " ");
          }

          // Optimization: Do not decode if it's not necessary.
          if (shouldDecodeKey) {
            try {
              key = decodeURIComponent(key);
            } catch {
              key = decodeLenient(key);
            }
          }

          if (hasBothKeyValuePair) {
            value = input.slice(equalityIndex + 1, i);

            if (valueHasPlus) {
              value = value.replace(plusRegex, " ");
            }

            if (shouldDecodeValue) {
              try {
                value = decodeURIComponent(value);
              } catch {
                value = decodeLenient(value);
              }
            }
          }
          const currentValue = params[key];

          if (currentValue === undefined) {
            params[key] = value;
          } else {
            if (Array.isArray(currentValue)) {
              currentValue.push(value);
            } else {
              params[key] = [currentValue, value];
            }
          }
        }

        // Reset reading key value pairs
        value = "";
        startingIndex = i;
        equalityIndex = i;
        shouldDecodeKey = false;
        shouldDecodeValue = false;
        keyHasPlus = false;
        valueHasPlus = false;

        break;
      }
      case 61 /* = */: {
        if (equalityIndex <= startingIndex) {
          equalityIndex = i;
        }
        // If '=' character occurs again, we should decode the input.
        else {
          shouldDecodeValue = true;
        }
        break;
      }
      case 43 /* + */: {
        if (equalityIndex > startingIndex) {
          valueHasPlus = true;
        } else {
          keyHasPlus = true;
        }
        break;
      }
      case 37 /* % */: {
        if (equalityIndex > startingIndex) {
          shouldDecodeValue = true;
        } else {
          shouldDecodeKey = true;
        }
        break;
      }
      // No default
    }
  }

  return params;
}

// `decodeURIComponent` throws on a single malformed escape. Decode the valid ones
// and keep the rest, like `URLSearchParams` and `node:querystring` do.
// `+` is already replaced and `&` can't occur here, so the value passes through as-is.
function decodeLenient(str: string): string {
  return new URLSearchParams("_=" + str).get("_")!;
}
