import { describe, expect, it, vi } from "vitest";
import { H3 } from "../../src/index.ts";
import { routeRules } from "../../src/rules/middleware.ts";
import { proxy } from "../../src/rules/proxy.ts";
import { createMatcherFromFind, createRouteRulesMatcher } from "../../src/rules/match.ts";
import type { FindRouteRules } from "../../src/rules/match.ts";
import type { RouteRuleLayer } from "../../src/rules/merge.ts";
import { normalizeRouteRules } from "../../src/rules/normalize.ts";
import { decodeRoutePattern } from "../../src/rules/internal/key.ts";
import { decodedPath, isPathInScope } from "../../src/rules/internal/scope.ts";
import { resolveRuleTarget } from "../../src/rules/handlers/_utils.ts";
import type { ProxyRuleOptions } from "../../src/rules/types.ts";

// `event.url.pathname` is `decodeURI`-d once, which by definition preserves
// *reserved* characters — so a rule pattern written with the character itself
// (`/@admin/**`, the natural spelling) must also match the percent-encoded
// request spelling (`/%40admin/...`), which any decoding consumer — a proxied
// backend, a static asset store, nginx — resolves back to it.
const AUTH = { username: "admin", password: "s3cr3t", realm: "Admin" } as const;

// Every reserved character `decodeURI` leaves encoded, plus the escapes the URL
// serializer re-adds (space, non-ASCII). `?`/`#` are omitted: they terminate the
// path, so neither can occur raw in a pathname.
const ENCODABLE: Array<[raw: string, encoded: string]> = [
  ["@", "%40"],
  [";", "%3B"],
  ["&", "%26"],
  ["=", "%3D"],
  ["+", "%2B"],
  ["$", "%24"],
  [",", "%2C"],
  [" ", "%20"],
  ["é", "%C3%A9"],
];

describe("encoded reserved characters cannot dodge a rule", () => {
  it.each(ENCODABLE)("`%s` written raw in the pattern still gates `%s`", (raw, encoded) => {
    const match = createRouteRulesMatcher(
      normalizeRouteRules({ [`/${raw}admin/**`]: { basicAuth: AUTH } }),
    );
    expect(match("GET", `/${raw}admin/data`).routeRules.basicAuth?.options).toMatchObject(AUTH);
    expect(match("GET", `/${encoded}admin/data`).routeRules.basicAuth?.options).toMatchObject(AUTH);
  });

  it.each(ENCODABLE)("`%s` written encoded in the pattern still gates the raw path", (raw, enc) => {
    const match = createRouteRulesMatcher(
      normalizeRouteRules({ [`/${enc}admin/**`]: { basicAuth: AUTH } }),
    );
    expect(match("GET", `/${enc}admin/data`).routeRules.basicAuth?.options).toMatchObject(AUTH);
    expect(match("GET", `/${raw}admin/data`).routeRules.basicAuth?.options).toMatchObject(AUTH);
  });

  it("gates the encoded spelling end to end, for every method", async () => {
    const app = new H3();
    app.use(routeRules({ "/@admin/**": { basicAuth: AUTH } }));
    app.all("/**", () => "secret");

    for (const path of ["/@admin/data", "/%40admin/data", "/%40admin/x/y"]) {
      const res = await app.fetch(new Request("http://test" + path));
      expect(res.status, path).toBe(401);
      expect(res.headers.get("www-authenticate"), path).toContain("Basic");
    }
    const post = await app.fetch(new Request("http://test/%40admin/action", { method: "POST" }));
    expect(post.status).toBe(401);

    // …and credentials still work through the encoded spelling.
    const ok = await app.fetch(
      new Request("http://test/%40admin/data", {
        headers: { authorization: "Basic " + btoa("admin:s3cr3t") },
      }),
    );
    expect(await ok.text()).toBe("secret");
  });

  it("does not gate a path that merely decodes to a different route", async () => {
    const app = new H3();
    app.use(routeRules({ "/@admin/**": { basicAuth: AUTH } }));
    app.all("/**", () => "public");
    // `%40admin` only matters as the first segment here.
    const res = await app.fetch(new Request("http://test/public/%40admin"));
    expect(res.status).toBe(200);
  });

  it("an encoded reading may add a rule but never downgrade a narrower one", () => {
    const match = createRouteRulesMatcher(
      normalizeRouteRules({
        "/**": { basicAuth: { username: "guest", password: "guest" } },
        "/@admin/**": { basicAuth: AUTH },
      }),
    );
    // Both spellings resolve the *narrow* gate, not the broad one.
    for (const path of ["/@admin/x", "/%40admin/x"]) {
      expect(match("GET", path).routeRules.basicAuth, path).toMatchObject({
        route: "/@admin/**",
        options: AUTH,
      });
    }
  });

  it("gates a `%25`-nested spelling a double-decoding downstream resolves", () => {
    // `%2540admin` survives h3's own decode as `%2540admin`; a proxy that decodes
    // and a backend that decodes again land on `/@admin`. The dot/separator
    // machinery already covers every `%25` depth (`%252e`, `%252f`), so the
    // decoded reading has to as well or the two disagree.
    const match = createRouteRulesMatcher(
      normalizeRouteRules({ "/@admin/**": { basicAuth: AUTH } }),
    );
    expect(match("GET", "/%2540admin/x").routeRules.basicAuth?.options).toMatchObject(AUTH);
    expect(match("GET", "/%25252540admin/x").routeRules.basicAuth?.options).toMatchObject(AUTH);
  });

  it("a `false` reset still applies through the encoded spelling", () => {
    const match = createRouteRulesMatcher(
      normalizeRouteRules({
        "/@admin/**": { basicAuth: AUTH },
        "/@admin/public/**": { basicAuth: false },
      }),
    );
    expect(match("GET", "/%40admin/public/x").routeRules.basicAuth).toBeUndefined();
    expect(match("GET", "/%40admin/private/x").routeRules.basicAuth).toBeDefined();
  });
});

describe("decodeRoutePattern", () => {
  it("decodes escapes that stand for an ordinary literal character", () => {
    expect(decodeRoutePattern("/%40admin/**")).toBe("/@admin/**");
    expect(decodeRoutePattern("/a%20b")).toBe("/a b");
    expect(decodeRoutePattern("/caf%C3%A9/x")).toBe("/café/x");
    expect(decodeRoutePattern("/plain/path")).toBe("/plain/path");
  });

  it("keeps escapes that would change how the pattern parses", () => {
    // rou3 syntax: decoding would turn a literal segment into a param /
    // wildcard / regex param.
    expect(decodeRoutePattern("/%3Aid/**")).toBe("/%3Aid/**");
    expect(decodeRoutePattern("/%2A")).toBe("/%2A");
    expect(decodeRoutePattern("/%28a%29")).toBe("/%28a%29");
    // Separators would change the pattern's segment count.
    expect(decodeRoutePattern("/a%2Fb")).toBe("/a%2Fb");
    expect(decodeRoutePattern("/a%5Cb")).toBe("/a%5Cb");
    // A `%` would fabricate a new escape.
    expect(decodeRoutePattern("/a%252fb")).toBe("/a%252fb");
  });

  it("leaves malformed encoding exactly as authored", () => {
    expect(decodeRoutePattern("/a%C3")).toBe("/a%C3");
  });

  it("is idempotent (byte-identical codegen depends on it)", () => {
    for (const pattern of ["/%40a/**", "/%3Aid", "/a%252fb", "/caf%C3%A9", "/a%C3"]) {
      expect(decodeRoutePattern(decodeRoutePattern(pattern))).toBe(decodeRoutePattern(pattern));
    }
  });

  it("merges rules whose keys collide once decoded", () => {
    const normalized = normalizeRouteRules({
      "/@admin/**": { headers: { "x-a": "1" } },
      "/%40admin/**": { headers: { "x-b": "2" } },
    });
    expect(Object.keys(normalized)).toEqual(["/@admin/**"]);
    expect(normalized["/@admin/**"]!.headers).toEqual({ "x-a": "1", "x-b": "2" });
  });
});

describe("decodedPath", () => {
  it("decodes every escape except the path separators", () => {
    expect(decodedPath("/%40admin/x")).toBe("/@admin/x");
    expect(decodedPath("/a%20b/caf%C3%A9")).toBe("/a b/café");
    // Separators stay opaque — decoding one here would reintroduce a `/` the
    // router never matched on (`canonicalPath`'s `decodeSlashes` owns that).
    expect(decodedPath("/a%2Fb")).toBe("/a%2Fb");
    expect(decodedPath("/a%252Fb")).toBe("/a%252Fb");
  });

  it("decodes to a fixpoint, without ever collapsing a separator", () => {
    expect(decodedPath("/%2540admin/x")).toBe("/@admin/x");
    expect(decodedPath("/%25252540admin/x")).toBe("/@admin/x");
    // A separator is at its fixpoint from the first pass, at any `%25` depth.
    expect(decodedPath("/a%2525252Fb")).toBe("/a%2525252Fb");
    // Hex-of-hex resolves to the *encoded* separator, never a raw one.
    expect(decodedPath("/a%25%32%66b")).toBe("/a%2fb");
  });

  it("is a no-op without escapes, and on malformed encoding", () => {
    const plain = "/plain/path";
    expect(decodedPath(plain)).toBe(plain);
    expect(decodedPath("/foo%")).toBe("/foo%");
    expect(decodedPath("/%ZZ")).toBe("/%ZZ");
  });
});

describe("scope checks see the decoded reading", () => {
  it("rejects a traversal whose dot is hex-of-hex encoded", () => {
    // `%25%32%65` decodes to `%2e`, which a second decode turns into `.` —
    // `resolveDotSegments` documents this as out of its reach on its own. h3's
    // own pathname decode already folds this particular spelling into `%252e`
    // (which `resolveDotSegments` does catch), so this is hardening for callers
    // that hand the matcher a path h3 did not serve — not a live h3 gap.
    expect(isPathInScope("/base/%25%32%65%25%32%65/secret", "/base")).toBe(false);
    expect(isPathInScope("/base/ok", "/base")).toBe(true);
    expect(isPathInScope("/base/a%40b", "/base")).toBe(true);
  });
});

describe("proxy/redirect base stripping through the encoded spelling", () => {
  // Resolve the forwarded target directly (as rules.test.ts does), so the
  // assertion is on the target URL rather than on a mocked fetch. `base` comes
  // from normalization, exactly as the handler receives it.
  const target = (path: string, to: string) => {
    const options = normalizeRouteRules({ "/@admin/**": { proxy: to } })["/@admin/**"]!.proxy;
    const event = { url: new URL("http://test" + path) } as Parameters<typeof resolveRuleTarget>[0];
    return resolveRuleTarget(event, options as ProxyRuleOptions);
  };

  it("strips the rule's base from the encoded spelling, forwarding raw bytes", () => {
    // The pattern prefix is `/@admin`, which `/%40admin/data` never literally
    // starts with — the base is taken by segment count instead, and the
    // remainder keeps its original encoding.
    expect(target("/@admin/data", "http://backend/**")).toBe("http://backend/data");
    expect(target("/%40admin/data", "http://backend/**")).toBe("http://backend/data");
    expect(target("/%40admin/a%2Fb", "http://backend/**")).toBe("http://backend/a%2Fb");
    expect(target("/%40admin/data?q=a%2Bb", "http://backend/**")).toBe(
      "http://backend/data?q=a%2Bb",
    );
  });

  it("fails closed when the base cannot be faithfully stripped", async () => {
    // The rule matches through the decoded path's canonical reading
    // (`/@admin/x`), but no reading of the *raw* path literally sits under
    // `/@admin` — an encoded separator sits exactly on the base boundary — so
    // the remainder can't be stripped and the request is rejected rather than
    // forwarded unstripped.
    const app = new H3();
    app.use(routeRules({ "/@admin/**": { proxy: "http://backend/**" } }, { handlers: { proxy } }));
    const res = await app.fetch(new Request("http://test/%40admin%2fx"));
    expect(res.status).toBe(400);
  });

  it("does not apply the rule at all to a path that traverses out of it", async () => {
    // `..%2f..%2f` walks above `/@admin` under every reading, so the proxy rule
    // never matches — nothing is forwarded.
    const app = new H3();
    app.use(routeRules({ "/@admin/**": { proxy: "http://backend/**" } }, { handlers: { proxy } }));
    const res = await app.fetch(new Request("http://test/%40admin/..%2f..%2fetc/passwd"));
    expect(res.status).toBe(404);
  });
});

describe("alternate-reading lookups", () => {
  const findNothing: FindRouteRules = () => [] as RouteRuleLayer[];

  it("costs no extra lookup for a plain path", () => {
    const find = vi.fn(findNothing);
    createMatcherFromFind(find)("GET", "/plain/path");
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("adds exactly one decoded lookup for an encoded path", () => {
    const find = vi.fn(findNothing);
    createMatcherFromFind(find)("GET", "/%40admin/data");
    expect(find).toHaveBeenCalledTimes(2);
    expect(find).toHaveBeenNthCalledWith(2, "GET", "/@admin/data");
  });

  it("looks up each distinct reading once", () => {
    const find = vi.fn(findNothing);
    // Both spellings canonicalize to `/a/b`, so the decoded reading adds no
    // lookup of its own.
    createMatcherFromFind(find)("GET", "/a/%40x/../b");
    expect(find.mock.calls.map((c) => c[1])).toEqual(["/a/%40x/../b", "/a/b"]);
  });
});

describe("routeRules middleware over the encoded spelling", () => {
  it("runs the matched rule middleware exactly once per request", async () => {
    const app = new H3();
    app.use(routeRules({ "/@admin/**": { headers: { "x-rule": "1" } } }));
    app.all("/**", () => "ok");
    const res = await app.fetch(new Request("http://test/%40admin/x"));
    expect(res.headers.get("x-rule")).toBe("1");
  });
});
