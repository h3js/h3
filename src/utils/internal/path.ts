export function withoutTrailingSlash(path: string | undefined): string {
  if (!path || path === "/") {
    return "/";
  }
  // eslint-disable-next-line unicorn/prefer-at
  return path[path.length - 1] === "/" ? path.slice(0, -1) : path;
}

export function joinURL(base: string | undefined, path: string | undefined): string {
  if (!base || base === "/") {
    return path || "/";
  }
  if (!path || path === "/") {
    return base || "/";
  }
  // eslint-disable-next-line unicorn/prefer-at
  const baseHasTrailing = base[base.length - 1] === "/";
  const pathHasLeading = path[0] === "/";
  if (baseHasTrailing && pathHasLeading) {
    return base + path.slice(1);
  }
  if (!baseHasTrailing && !pathHasLeading) {
    return base + "/" + path;
  }
  return base + path;
}

export function withoutBase(input: string = "", base: string = ""): string {
  if (!base || base === "/") {
    return input;
  }
  const _base = withoutTrailingSlash(base);
  if (!input.startsWith(_base) || (input.length > _base.length && input[_base.length] !== "/")) {
    return input;
  }
  // Collapse leading slashes to prevent protocol-relative URL injection
  // e.g. withoutBase("/legacy//evil.com", "/legacy") must not return "//evil.com"
  const trimmed = input.slice(_base.length).replace(/^\/+/, "");
  return "/" + trimmed;
}

/**
 * Strip `base` from `pathname` when it matches on a segment boundary, collapsing
 * the leading-slash run so `/base//evil.com` can never strip to a protocol-relative
 * `//evil.com` a downstream redirect could turn into an open redirect.
 */
export function stripBase(pathname: string, base: string): string {
  if (pathname === base || pathname.startsWith(base + "/")) {
    return "/" + pathname.slice(base.length).replace(/^\/+/, "");
  }
  return pathname;
}

export function getPathname(path: string = "/"): string {
  return path.startsWith("/") ? path.split("?")[0] : new URL(path, "http://localhost").pathname;
}

/**
 * Decode percent-encoded pathname, preserving %25 (literal `%`).
 */
export function decodePathname(pathname: string): string {
  return decodeURI(pathname.includes("%25") ? pathname.replace(/%25/g, "%2525") : pathname);
}
