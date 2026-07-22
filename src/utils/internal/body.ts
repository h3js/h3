import { EmptyObject } from "./obj.ts";
import { hasProp } from "./object.ts";

export function parseURLEncodedBody(body: string): unknown {
  return collectEntries(new URLSearchParams(body).entries());
}

export function parseFormData(form: FormData): unknown {
  return collectEntries(form.entries());
}

// Collect key/value entries into an object, keeping repeated keys as arrays
// (e.g. multi-selects or `foo=1&foo=2`) instead of dropping earlier values.
function collectEntries(entries: IterableIterator<[string, unknown]>): unknown {
  const parsed: Record<string, any> = new EmptyObject();
  for (const [key, value] of entries) {
    if (hasProp(parsed, key)) {
      if (!Array.isArray(parsed[key])) {
        parsed[key] = [parsed[key]];
      }
      parsed[key].push(value);
    } else {
      parsed[key] = value;
    }
  }
  return parsed as unknown;
}
