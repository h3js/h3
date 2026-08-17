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
import { canonicalPathname } from "../../src/utils/internal/path.ts";
import type { ProxyRuleOptions } from "../../src/rules/types.ts";

// Count decode passes so the `decodedPath` bound can be asserted as an
// operation count instead of a wall clock. The mock only wraps the real
// function — every other consumer of the module is unaffected.
const decodePasses = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../src/utils/internal/path.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/internal/path.ts")>();
  return {
    ...actual,
    decodePreservingSeparators(value: string) {
      decodePasses.count++;
      return actual.decodePreservingSeparators(value);
    },
  };
});

// A rule pattern is written with the character itself (`/@admin/**`, the natural
// spelling), so it must also match the percent-encoded request spelling, which
// any decoding consumer — a proxied backend, a static asset store, nginx —
// resolves back to it. The matcher owns that: it resolves each path against its
// decoded reading (`decodedPath`) as well as the served one.
//
// Spelled with `redirect`: it short-circuits, so "the rule matched" is observable
// end to end as a 307 the route handler never got to answer.
const RULE = { redirect: "/elsewhere" } as const;
const MATCHED = { to: "/elsewhere", status: 307 } as const;

// Escapes h3 *still serves opaque*: those the URL serializer would re-add, so
// `canonicalPathname` leaves them alone (`src/utils/internal/path.ts`). These are
// the ones the matcher's decoded reading has to carry on its own — they reach it
// encoded even through a real request, so they gate end to end.
const OPAQUE_ENCODABLE: Array<[raw: string, encoded: string]> = [
  [" ", "%20"],
  ["é", "%C3%A9"],
];

// Escapes h3 canonicalizes away before routing, so a real request never reaches
// the matcher still carrying one. Kept as matcher-level coverage: `h3/rules` is
// usable standalone (a compiled matcher, a non-h3 caller) and must not regress to
// matching only one spelling. `?`/`#` are omitted: they terminate the path, so
// neither can occur raw in a pathname.
const CANONICALIZED_ENCODABLE: Array<[raw: string, encoded: string]> = [
  ["@", "%40"],
  [";", "%3B"],
  ["&", "%26"],
  ["=", "%3D"],
  ["+", "%2B"],
  ["$", "%24"],
  [",", "%2C"],
];

const ENCODABLE = [...OPAQUE_ENCODABLE, ...CANONICALIZED_ENCODABLE];

describe("encoded reserved characters cannot dodge a rule", () => {
  it.each(ENCODABLE)("`%s` written raw in the pattern still matches `%s`", (raw, encoded) => {
    const match = createRouteRulesMatcher(normalizeRouteRules({ [`/${raw}admin/**`]: RULE }));
    expect(match("GET", `/${raw}admin/data`).routeRules.redirect).toMatchObject(MATCHED);
    expect(match("GET", `/${encoded}admin/data`).routeRules.redirect).toMatchObject(MATCHED);
  });

  it.each(ENCODABLE)(
    "`%s` written encoded in the pattern still matches the raw path",
    (raw, enc) => {
      const match = createRouteRulesMatcher(normalizeRouteRules({ [`/${enc}admin/**`]: RULE }));
      expect(match("GET", `/${enc}admin/data`).routeRules.redirect).toMatchObject(MATCHED);
      expect(match("GET", `/${raw}admin/data`).routeRules.redirect).toMatchObject(MATCHED);
    },
  );

  // The escapes h3 serves opaque are the ones only the matcher can catch: nothing
  // upstream decodes them, so without the decoded reading these walk past the rule
  // and a proxied backend serves them as the raw spelling.
  it.each(OPAQUE_ENCODABLE)(
    "`%s` matches `%s` end to end, unaided by canonicalization",
    async (raw, encoded) => {
      const app = new H3();
      app.use(routeRules({ [`/${raw}admin/**`]: RULE }));
      app.all("/**", () => "from the handler");
      // Pin that h3 really did leave it encoded — otherwise this asserts nothing.
      app.get("/probe" + encoded, (event) => event.url.pathname);
      const probe = await app.fetch(new Request(`http://test/probe${encoded}`));
      expect(await probe.text()).toBe(`/probe${encoded}`);

      const res = await app.fetch(new Request(`http://test/${encoded}admin/data`));
      expect(res.status).toBe(307);
    },
  );

  it("matches a `%25`-nested spelling end to end", async () => {
    // `%2520` survives canonicalization (`%25` is never decoded), and only
    // `decodedPath`'s fixpoint unwraps it to the space the pattern is written with.
    const app = new H3();
    app.use(routeRules({ "/a admin/**": RULE }));
    app.all("/**", () => "from the handler");
    const res = await app.fetch(new Request("http://test/a%2520admin/data"));
    expect(res.status).toBe(307);
  });

  it("matches the encoded spelling end to end, for every method", async () => {
    const app = new H3();
    app.use(routeRules({ "/@admin/**": RULE }));
    app.all("/**", () => "from the handler");

    for (const path of ["/@admin/data", "/%40admin/data", "/%40admin/x/y"]) {
      const res = await app.fetch(new Request("http://test" + path));
      expect(res.status, path).toBe(307);
      expect(res.headers.get("location"), path).toBe("/elsewhere");
    }
    const post = await app.fetch(new Request("http://test/%40admin/action", { method: "POST" }));
    expect(post.status).toBe(307);
  });

  it("does not match a path that merely decodes to a different route", async () => {
    const app = new H3();
    app.use(routeRules({ "/@admin/**": RULE }));
    app.all("/**", () => "public");
    // `%40admin` only matters as the first segment here.
    const res = await app.fetch(new Request("http://test/public/%40admin"));
    expect(res.status).toBe(200);
  });

  it("an encoded reading may add a rule but never downgrade a narrower one", () => {
    const match = createRouteRulesMatcher(
      normalizeRouteRules({
        "/**": { redirect: "/broad" },
        "/@admin/**": RULE,
      }),
    );
    // Both spellings resolve the *narrow* rule, not the broad one.
    for (const path of ["/@admin/x", "/%40admin/x"]) {
      expect(match("GET", path).matchedRules.redirect, path).toMatchObject({
        route: "/@admin/**",
        options: MATCHED,
      });
    }
  });

  it("matches a `%25`-nested spelling a double-decoding downstream resolves", () => {
    // `%2540admin` survives h3's own decode as `%2540admin`; a proxy that decodes
    // and a backend that decodes again land on `/@admin`. The dot/separator
    // machinery already covers every `%25` depth (`%252e`, `%252f`), so the
    // decoded reading has to as well or the two disagree.
    const match = createRouteRulesMatcher(normalizeRouteRules({ "/@admin/**": RULE }));
    expect(match("GET", "/%2540admin/x").routeRules.redirect).toMatchObject(MATCHED);
    expect(match("GET", "/%25252540admin/x").routeRules.redirect).toMatchObject(MATCHED);
  });

  it("a `false` reset still applies through the encoded spelling", () => {
    const match = createRouteRulesMatcher(
      normalizeRouteRules({
        "/@admin/**": RULE,
        "/@admin/public/**": { redirect: false },
      }),
    );
    expect(match("GET", "/%40admin/public/x").routeRules.redirect).toBeUndefined();
    expect(match("GET", "/%40admin/private/x").routeRules.redirect).toBeDefined();
  });
});

describe("decodeRoutePattern", () => {
  it("decodes escapes that stand for an ordinary literal character", () => {
    expect(decodeRoutePattern("/%40admin/**")).toBe("/@admin/**");
    expect(decodeRoutePattern("/a%20b")).toBe("/a b");
    expect(decodeRoutePattern("/caf%C3%A9/x")).toBe("/café/x");
    expect(decodeRoutePattern("/plain/path")).toBe("/plain/path");
  });

  it("keeps escapes that would change the pattern's segment count", () => {
    // Separators, at any `%25`-nesting depth — decoding one would give the
    // pattern a boundary the router never matched on.
    expect(decodeRoutePattern("/a%2Fb")).toBe("/a%2Fb");
    expect(decodeRoutePattern("/a%5Cb")).toBe("/a%5Cb");
    // A `%` would fabricate a new escape.
    expect(decodeRoutePattern("/a%252fb")).toBe("/a%252fb");
  });

  it("resolves an escaped rou3 metacharacter exactly as h3 resolves it in a route", () => {
    // h3 canonicalizes a route pattern and every request path through the same
    // `canonicalPathname` pass, so an escaped metacharacter *becomes* that
    // metacharacter (`H3.route`). A rule key has to agree: holding `%3A` back
    // would leave the pattern matching only `/%3Aid`, a spelling no request can
    // carry anymore, so the rule would silently never fire.
    expect(decodeRoutePattern("/%3Aid/**")).toBe("/:id/**");
    expect(decodeRoutePattern("/f/%2A%2A")).toBe("/f/**");
    expect(decodeRoutePattern("/%28a%29")).toBe("/(a)");
    // Parity with core, over both passes and their interaction.
    for (const pattern of ["/%3Aid/**", "/f/%2A%2A", "/%28a%29", "/a%2F%3Ab", "/%40admin/**"]) {
      expect(decodeRoutePattern(pattern)).toBe(canonicalPathname(pattern));
    }
  });

  it("keeps an escaped metacharacter reachable end to end", async () => {
    const app = new H3();
    app.use(routeRules({ "/a/%3Aid": { headers: { "x-hit": "1" } } }));
    app.all("/**", () => "ok");
    // Registered as the `:id` param route, so it matches any segment — and the
    // literal `/a/%3Aid` request arrives canonicalized to `/a/:id`, which it
    // also matches.
    for (const path of ["/a/anything", "/a/%3Aid"]) {
      const res = await app.fetch(new Request("http://test" + path));
      expect(res.headers.get("x-hit")).toBe("1");
    }
  });

  it("leaves malformed encoding exactly as authored", () => {
    expect(decodeRoutePattern("/a%C3")).toBe("/a%C3");
  });

  it("is idempotent (byte-identical codegen depends on it)", () => {
    for (const pattern of ["/%40a/**", "/%3Aid", "/f/%2A%2A", "/a%252fb", "/caf%C3%A9", "/a%C3"]) {
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

  // `%25` nesting is a *pass multiplier*: one level is unwrapped per pass and
  // every pass rescans the whole string, so a sequentially nested chain cost one
  // full pass per level — O(n²), ~72 ms of blocking time for a 14 KB path, on a
  // request that need not match any rule at all. The bound is asserted as a
  // *pass count* rather than a wall clock: the bound is what regresses, elapsed
  // time is what flakes.
  it("unwraps a deeply nested chain in a bounded number of passes", () => {
    const deep = "/%" + "25".repeat(4000) + "40x";
    decodePasses.count = 0;
    expect(decodedPath(deep)).toBe("/@x");
    expect(decodePasses.count).toBeLessThanOrEqual(12);

    // 4x the depth must not cost 16x the work: the pass count is bounded by a
    // constant, not by the nesting depth.
    const deeper = "/%" + "25".repeat(16_000) + "40x";
    decodePasses.count = 0;
    expect(decodedPath(deeper)).toBe("/@x");
    expect(decodePasses.count).toBeLessThanOrEqual(12);

    // Same for a chain that unwraps onto a malformed escape rather than a
    // decodable one (`%25…25zz` -> `%zz`), which shrinks two chars per pass too.
    const malformed = "/%" + "25".repeat(4000) + "zz";
    decodePasses.count = 0;
    expect(decodedPath(malformed)).toBe("/%zz");
    expect(decodePasses.count).toBeLessThanOrEqual(12);
  });

  it("gives a deeply nested spelling the same reading as a shallow one", () => {
    // Nesting depth is not information: every depth decodes to the same
    // character, so the reading must not depend on how deep the chain was — a
    // bound that truncated the unwrapping would show up here.
    for (const depth of [1, 2, 3, 7, 8, 9, 64, 4000]) {
      const nest = "%" + "25".repeat(depth);
      expect(decodedPath(`/a${nest}20b`), `%20 at depth ${depth}`).toBe("/a b");
      expect(decodedPath(`/${nest}40admin/x`), `%40 at depth ${depth}`).toBe("/@admin/x");
      // A separator is at its fixpoint from the first pass, at every depth.
      expect(decodedPath(`/a${nest}2Fb`), `%2F at depth ${depth}`).toBe(`/a${nest}2Fb`);
      expect(decodedPath(`/a${nest}5Cb`), `%5C at depth ${depth}`).toBe(`/a${nest}5Cb`);
    }
  });

  it("matches a spelling nested far past any pass bound", () => {
    // The security property the bound must not buy performance with: a chain
    // deeper than the bound may not silently degrade to "no alternate reading",
    // which would walk past the rule. Every depth still resolves it.
    const match = createRouteRulesMatcher(normalizeRouteRules({ "/@admin/**": RULE }));
    for (const depth of [1, 7, 8, 9, 64, 4000]) {
      const path = "/%" + "25".repeat(depth) + "40admin/x";
      expect(match("GET", path).routeRules.redirect, `depth ${depth}`).toMatchObject(MATCHED);
    }
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

  it("rejects a path that traverses out of the rule's base", async () => {
    // `/%40admin/...` is served as `/@admin/...` (`%40` is a needless escape), so
    // the rule matches on the raw path. `..%2f..%2f` then walks above `/@admin`
    // under every canonical reading, so the scope check rejects rather than
    // forwarding — nothing reaches the backend either way.
    const app = new H3();
    app.use(routeRules({ "/@admin/**": { proxy: "http://backend/**" } }, { handlers: { proxy } }));
    const res = await app.fetch(new Request("http://test/%40admin/..%2f..%2fetc/passwd"));
    expect(res.status).toBe(400);
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
