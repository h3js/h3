import supertest, { SuperTest, Test } from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import {
  createApp,
  createRouter,
  App,
  Router,
  toNodeListener,
  eventHandler,
  getHeader,
  createError,
  getRouterParams,
  getQuery,
  useBase,
} from "../src";

describe("security: path encoding bypass", () => {
  let app: App;
  let router: Router;
  let request: SuperTest<Test>;

  beforeEach(() => {
    app = createApp({ debug: false });

    // Middleware that protects /api/admin routes
    app.use(
      eventHandler((event) => {
        if (event.path.startsWith("/api/admin")) {
          const token = getHeader(event, "authorization");
          if (token !== "Bearer admin-secret-token") {
            throw createError({ statusCode: 403, statusMessage: "Forbidden" });
          }
        }
      }),
    );

    router = createRouter();

    // Protected admin endpoint with dynamic param
    router.get(
      "/api/admin/:action",
      eventHandler((event) => {
        const params = getRouterParams(event, { decode: true });
        return { admin: true, action: params.action };
      }),
    );

    // Public endpoint
    router.get(
      "/api/public",
      eventHandler(() => {
        return { public: true };
      }),
    );

    app.use(router);
    request = supertest(toNodeListener(app)) as any;
  });

  it("blocks unauthenticated access to /api/admin/users", async () => {
    const res = await request.get("/api/admin/users");
    expect(res.status).toBe(403);
  });

  it("allows authenticated access to /api/admin/users", async () => {
    const res = await request
      .get("/api/admin/users")
      .set("Authorization", "Bearer admin-secret-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ admin: true, action: "users" });
  });

  it("allows access to public endpoint", async () => {
    const res = await request.get("/api/public");
    expect(res.status).toBe(200);
  });

  // Percent-encoding a single character in the protected prefix
  it("should NOT bypass auth via /api/%61dmin/users (%61 = a)", async () => {
    const res = await request.get("/api/%61dmin/users");
    expect(res.status).not.toBe(200);
  });

  it("should NOT bypass auth via /api/admi%6e/users (%6e = n)", async () => {
    const res = await request.get("/api/admi%6e/users");
    expect(res.status).not.toBe(200);
  });

  // Encoding in a different path segment
  it("should NOT bypass auth via /%61pi/admin/users (%61 = a)", async () => {
    const res = await request.get("/%61pi/admin/users");
    expect(res.status).not.toBe(200);
  });

  // Double-encoded percent (%25 = literal %) should not resolve to the protected path
  it("should NOT bypass auth via double encoding /api/%2561dmin/users", async () => {
    const res = await request.get("/api/%2561dmin/users");
    expect(res.status).not.toBe(200);
  });

  // Uppercase hex variants
  it("should NOT bypass auth via /api/%41dmin/users (uppercase %41 = A)", async () => {
    const res = await request.get("/api/%41dmin/users");
    expect(res.status).not.toBe(200);
  });

  // Multiple encoded characters
  it("should NOT bypass auth via fully encoded /api/admin path", async () => {
    // /api/%61%64%6d%69%6e/users = /api/admin/users
    const res = await request.get("/api/%61%64%6d%69%6e/users");
    expect(res.status).not.toBe(200);
  });
});

describe("security: path encoding bypass with wildcard routes", () => {
  let app: App;
  let router: Router;
  let request: SuperTest<Test>;

  beforeEach(() => {
    app = createApp({ debug: false });

    // Middleware protecting /api/admin
    app.use(
      eventHandler((event) => {
        if (event.path.startsWith("/api/admin")) {
          const token = getHeader(event, "authorization");
          if (token !== "Bearer admin-secret-token") {
            throw createError({ statusCode: 403, statusMessage: "Forbidden" });
          }
        }
      }),
    );

    router = createRouter();

    // Catch-all route (simulates Nuxt/Nitro file-based routing)
    router.get(
      "/api/**",
      eventHandler((event) => {
        return { path: event.path, params: getRouterParams(event) };
      }),
    );

    app.use(router);
    request = supertest(toNodeListener(app)) as any;
  });

  it("blocks /api/admin/users without auth via wildcard", async () => {
    const res = await request.get("/api/admin/users");
    expect(res.status).toBe(403);
  });

  it("should NOT bypass auth with wildcard via /api/%61dmin/users", async () => {
    const res = await request.get("/api/%61dmin/users");
    expect(res.status).not.toBe(200);
  });

  it("should NOT bypass auth with wildcard via /api/admi%6e/users", async () => {
    const res = await request.get("/api/admi%6e/users");
    expect(res.status).not.toBe(200);
  });
});

describe("path decoding: no regressions", () => {
  let app: App;
  let router: Router;
  let request: SuperTest<Test>;

  beforeEach(() => {
    app = createApp({ debug: false });
    router = createRouter();

    // Echo handler returning path and query info
    router.get(
      "/echo/**",
      eventHandler((event) => {
        return {
          path: event.path,
          query: getQuery(event),
          params: getRouterParams(event),
        };
      }),
    );

    router.get(
      "/item/:id",
      eventHandler((event) => {
        return {
          path: event.path,
          params: getRouterParams(event),
        };
      }),
    );

    app.use(router);
    request = supertest(toNodeListener(app)) as any;
  });

  it("preserves query strings without double-decoding", async () => {
    const res = await request.get("/echo/test?val=%2561");
    expect(res.status).toBe(200);
    // %2561 should stay raw in the query portion of event.path
    expect(res.body.path).toBe("/echo/test?val=%2561");
    // getQuery decodes once: %2561 -> %61 (literal percent-sixty-one)
    expect(res.body.query.val).toBe("%61");
  });

  it("preserves encoded values in query strings", async () => {
    const res = await request.get(
      "/echo/test?name=hello%20world&redirect=%2Fhome",
    );
    expect(res.status).toBe(200);
    expect(res.body.query.name).toBe("hello world");
    expect(res.body.query.redirect).toBe("/home");
  });

  it("preserves query string with multiple params", async () => {
    const res = await request.get("/echo/test?a=1&b=2&c=%263");
    expect(res.status).toBe(200);
    expect(res.body.query).toMatchObject({ a: "1", b: "2", c: "&3" });
  });

  it("decodes path but not query in the same request", async () => {
    // Path has %74 (t), query has %2561 (should stay as-is)
    const res = await request.get("/echo/%74est?key=%2561");
    expect(res.status).toBe(200);
    expect(res.body.path).toBe("/echo/test?key=%2561");
    expect(res.body.query.key).toBe("%61");
  });

  it("preserves encoded slash %2F in path (not decoded to /)", async () => {
    const res = await request.get("/echo/a%2Fb");
    expect(res.status).toBe(200);
    // decodePath from ufo preserves %2F
    expect(res.body.path).toBe("/echo/a%2Fb");
  });

  it("decodes space %20 in path segments", async () => {
    const res = await request.get("/echo/hello%20world");
    expect(res.status).toBe(200);
    expect(res.body.path).toBe("/echo/hello world");
  });

  it("handles already-decoded paths unchanged", async () => {
    const res = await request.get("/echo/normal/path");
    expect(res.status).toBe(200);
    expect(res.body.path).toBe("/echo/normal/path");
  });

  it("handles path with no query string", async () => {
    const res = await request.get("/item/42");
    expect(res.status).toBe(200);
    expect(res.body.path).toBe("/item/42");
    expect(res.body.params).toEqual({ id: "42" });
  });

  it("handles empty query string", async () => {
    const res = await request.get("/echo/test?");
    expect(res.status).toBe(200);
    // Node.js/supertest strips trailing empty "?", so path has no query
    expect(res.body.path).toBe("/echo/test");
  });

  it("originalUrl preserves the raw request URL", async () => {
    const router2 = createRouter();
    const app2 = createApp({ debug: false });
    let capturedOriginalUrl: string | undefined;
    app2.use(
      eventHandler((event) => {
        capturedOriginalUrl = event.node.req.originalUrl;
      }),
    );
    router2.get(
      "/test/**",
      eventHandler(() => "ok"),
    );
    app2.use(router2);
    const req2 = supertest(toNodeListener(app2)) as any;
    await req2.get("/test/%61bc");
    expect(capturedOriginalUrl).toBe("/test/%61bc");
  });

  it("req.url preserves percent-encoded UTF-8 characters", async () => {
    const app2 = createApp({ debug: false });
    let capturedReqUrl: string | undefined;
    app2.use(
      eventHandler((event) => {
        capturedReqUrl = event.node.req.url;
        return { path: event.path, reqUrl: capturedReqUrl };
      }),
    );
    const req2 = supertest(toNodeListener(app2)) as any;
    // %C3%A9 is the percent-encoded form of "é" (UTF-8)
    const res = await req2.get("/test/caf%C3%A9");
    expect(res.status).toBe(200);
    // event.path should be decoded (for h3 internal routing)
    expect(res.body.path).toBe("/test/café");
    // req.url must stay percent-encoded (for HTTP proxies and middleware)
    expect(res.body.reqUrl).toBe("/test/caf%C3%A9");
  });
});

describe("path decoding with useBase", () => {
  let app: App;
  let request: SuperTest<Test>;

  beforeEach(() => {
    app = createApp({ debug: false });
    const baseHandler = eventHandler((event) => {
      return { path: event.path };
    });
    app.use("/api", useBase("/api", baseHandler));
    request = supertest(toNodeListener(app)) as any;
  });

  it("decodes path with useBase prefix", async () => {
    const res = await request.get("/api/t%65st");
    expect(res.status).toBe(200);
    // useBase strips the /api prefix, so handler sees /test
    expect(res.body.path).toBe("/test");
  });
});

describe("path decoding with onRequest hook", () => {
  it("event.path is decoded in onRequest", async () => {
    let hookPath: string | undefined;
    const app = createApp({
      debug: false,
      onRequest(event) {
        hookPath = event.path;
      },
    });
    const router = createRouter();
    router.get(
      "/api/**",
      eventHandler(() => "ok"),
    );
    app.use(router);
    const request = supertest(toNodeListener(app)) as any;
    await request.get("/api/%61dmin");
    expect(hookPath).toBe("/api/admin");
  });
});
