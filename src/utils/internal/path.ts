export function withLeadingSlash(path: string | undefined): string {
  if (!path || path === "/") {
    return "/";
  }
  return path[0] === "/" ? path : `/${path}`;
}

export function withoutTrailingSlash(path: string | undefined): string {
  if (!path || path === "/") {
    return "/";
  }
  // eslint-disable-next-line unicorn/prefer-at
  return path[path.length - 1] === "/" ? path.slice(0, -1) : path;
}

export function joinURL(
  base: string | undefined,
  path: string | undefined,
): string {
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
  if (!input.startsWith(_base)) {
    return input;
  }
  const trimmed = input.slice(_base.length);
  return trimmed[0] === "/" ? trimmed : "/" + trimmed;
}

export function getPathname(path: string = "/"): string {
  return path.startsWith("/")
    ? path.split("?")[0]
    : new URL(path, "http://localhost").pathname;
}
