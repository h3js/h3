// Media type helpers shared by the HTTP QUERY method utilities (RFC 10008).

// sf-token: ( ALPHA / "*" ) *( tchar / ":" / "/" ) — https://www.rfc-editor.org/rfc/rfc8941#section-3.3.4
const SF_TOKEN_RE = /^[A-Za-z*][\w!#$%&'*+.^`|~:/-]*$/;
// sf-key: ( lcalpha / "*" ) *( lcalpha / DIGIT / "_" / "-" / "." / "*" )
const SF_KEY_RE = /^[a-z*][a-z0-9_.*-]*$/;

/**
 * Serialize media types into an `Accept-Query` header value: a
 * [Structured Fields](https://www.rfc-editor.org/rfc/rfc8941) List where the
 * base media type becomes a token and any `;name=value` parameters are
 * emitted with their values as quoted strings.
 */
export function serializeAcceptQuery(mediaTypes: string[]): string {
  return mediaTypes.map(serializeMediaType).join(", ");
}

/** Extract the lower-cased `type/subtype` part of a media type, dropping parameters. */
export function baseMediaType(mediaType: string): string {
  return mediaType.split(";")[0].trim().toLowerCase();
}

/** Match a concrete `type/subtype` against an accepted type that may use wildcards. */
export function mediaTypeMatches(mediaType: string, accepted: string): boolean {
  if (accepted === "*/*" || accepted === "*") {
    return true;
  }
  if (accepted === mediaType) {
    return true;
  }
  if (accepted.endsWith("/*")) {
    return mediaType.startsWith(accepted.slice(0, -1));
  }
  return false;
}

/** Serialize a `type/subtype;param=value` media type into a Structured Fields item. */
function serializeMediaType(mediaType: string): string {
  const parts = splitOutsideQuotes(mediaType, ";");
  const base = parts[0].trim();
  if (!SF_TOKEN_RE.test(base)) {
    throw new TypeError(`Invalid media type: ${JSON.stringify(mediaType)}`);
  }
  let result = base;
  for (let i = 1; i < parts.length; i++) {
    const param = parts[i].trim();
    if (!param) {
      continue;
    }
    const eq = param.indexOf("=");
    const key = (eq === -1 ? param : param.slice(0, eq)).trim().toLowerCase();
    if (!SF_KEY_RE.test(key)) {
      throw new TypeError(`Invalid media type parameter: ${JSON.stringify(param)}`);
    }
    // Bare parameters serialize to the boolean `true` (an implicit `;key`).
    result +=
      eq === -1 ? `;${key}` : `;${key}="${escapeQuotes(unquote(param.slice(eq + 1).trim()))}"`;
  }
  return result;
}

/** Split on `sep` while ignoring separators inside double-quoted strings. */
function splitOutsideQuotes(input: string, sep: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      current += ch;
      if (ch === "\\" && i + 1 < input.length) {
        current += input[++i];
      } else if (ch === '"') {
        inQuotes = false;
      }
    } else if (ch === '"') {
      inQuotes = true;
      current += ch;
    } else if (ch === sep) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function escapeQuotes(value: string): string {
  return value.replace(/[\\"]/g, "\\$&");
}

function unquote(value: string): string {
  if (value.length >= 2 && value[0] === '"' && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return value;
}
