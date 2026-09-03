/** Prepares the matched tail for one `**` position before it is spliced in. */
type SplatEncoder = (tail: string) => string;

/**
 * A `redirect`/`proxy` target split on the `**` placeholders that interpolate
 * the matched tail, produced once per handler by {@link parseSplatTemplate}.
 *
 * `literals` always holds one entry more than `encoders`: the resolved target
 * is `literals[0] + encoders[0](tail) + literals[1] + …`.
 */
export interface SplatTemplate {
  literals: string[];
  encoders: SplatEncoder[];
}

// Characters an `event.url.pathname` can carry raw (or that a decoding consumer
// would read differently) which are *structural* once the tail lands in a query
// or fragment value: `&` and the legacy `;` start another pair, `=` a value,
// `?`/`#` a component, and `+` form-decodes to a space. In a path position they
// are all inert, which is why only the value positions escape them.
const QUERY_UNSAFE_RE = /[#&+;=?]/g;

// The tail is forwarded in the request's own encoding, so `%` is deliberately
// not escaped: re-encoding it would double every escape the path already
// carries (`a%20b` reading back as a literal `a%20b` rather than `a b`).
const asQueryValue: SplatEncoder = (tail) =>
  tail.replace(QUERY_UNSAFE_RE, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

const asPath: SplatEncoder = (tail) => tail;

// The widest authority a URL parser might read out of a target. Deliberately
// broader than `getURLPathname`'s lexical reading (`utils/internal/path.ts`) —
// that one describes the bytes h3 forwards and must stay narrow; this one
// decides where a placeholder is *unsafe*, so it errs the other way. What the
// parser disagrees with a lexical reading about: a special scheme skips *every* `/` and `\\` after
// `scheme:` (`http:///evil.h/x` and `https:/evil.h/x` both have host
// `evil.h`), `\\` is a separator like `/` (`/\\evil.h` is protocol-relative),
// and a bare `//` starts an authority with no scheme at all. Reading the
// authority generously is the safe direction: it can only move a placeholder
// out of interpolation range, never into one.
const AUTHORITY_RE = /^(?:[a-z][a-z\d+.-]*:[/\\]*|[/\\]{2,})[^/\\?#]*/i;

/**
 * Index just past `target`'s authority, or `0` when it has none — the earliest
 * offset at which a placeholder is certain not to land in the destination host.
 */
function authorityEnd(target: string): number {
  return AUTHORITY_RE.exec(target)?.[0].length ?? 0;
}

/**
 * Whether `target`'s first `**` sits where it could choose the destination
 * host: inside the authority (`//**.cdn/x`, `http:///**.h`), or at offset `0`
 * of a target with no authority at all (`**`, `**.cdn/x`), where the tail
 * itself would supply the scheme and host. Such a target is never interpolated
 * (see {@link parseSplatTemplate}) and is rejected at config time.
 */
export function isHostPositionSplat(target: string): boolean {
  const index = target.indexOf("**");
  return index !== -1 && index <= authorityEnd(target);
}

/**
 * Split `target` on its interpolating `**` placeholders, or `undefined` when it
 * has none — and when its first one sits in host position, which stays part of
 * the leading literal exactly as it did before targets interpolated at all.
 */
export function parseSplatTemplate(target: string): SplatTemplate | undefined {
  let index = target.indexOf("**");
  if (index === -1 || index <= authorityEnd(target)) {
    return;
  }
  // The first `?`/`#` of the target ends its path; every placeholder past it
  // sits in a value, where raw path bytes would otherwise re-parse as syntax.
  const marker = target.search(/[?#]/);
  const valueStart = marker === -1 ? Number.POSITIVE_INFINITY : marker;
  const literals: string[] = [];
  const encoders: SplatEncoder[] = [];
  let last = 0;
  for (; index !== -1; index = target.indexOf("**", last)) {
    literals.push(target.slice(last, index));
    encoders.push(index > valueStart ? asQueryValue : asPath);
    last = index + 2;
  }
  literals.push(target.slice(last));
  return { literals, encoders };
}

/** Splice `tail` into every placeholder of `template`. */
export function interpolateSplat(template: SplatTemplate, tail: string): string {
  const { literals, encoders } = template;
  let resolved = literals[0]!;
  for (let i = 0; i < encoders.length; i++) {
    resolved += encoders[i]!(tail) + literals[i + 1]!;
  }
  return resolved;
}
