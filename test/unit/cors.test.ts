import { expect, it, describe, beforeEach, vi } from "vitest";
import {
  mockEvent,
  isPreflightRequest,
  isCorsOriginAllowed,
  appendCorsPreflightHeaders,
  appendCorsHeaders,
  handleCors,
  HTTPError,
} from "../../src/index.ts";
import { toResponse } from "../../src/response.ts";
import {
  resolveCorsOptions,
  createOriginHeaders,
  createMethodsHeaders,
  createCredentialsHeaders,
  createAllowHeaderHeaders,
  createExposeHeaders,
  createMaxAgeHeader,
} from "../../src/utils/internal/cors.ts";

import type { CorsOptions } from "../../src/index.ts";

describe("cors (unit)", () => {
  describe("resolveCorsOptions", () => {
    it("can merge default options and user options", () => {
      const options1 = resolveCorsOptions();
      const options2 = resolveCorsOptions({
        origin: ["https://example.com:3000"],
        methods: ["GET", "POST"],
        allowHeaders: ["CUSTOM-HEADER"],
        exposeHeaders: ["EXPOSED-HEADER"],
        maxAge: "12345",
        preflight: {
          statusCode: 404,
        },
      });

      expect(options1).toEqual({
        origin: "*",
        methods: "*",
        allowHeaders: "*",
        exposeHeaders: "*",
        credentials: false,
        maxAge: false,
        preflight: {
          statusCode: 204,
        },
      });
      expect(options2).toEqual({
        origin: ["https://example.com:3000"],
        methods: ["GET", "POST"],
        allowHeaders: ["CUSTOM-HEADER"],
        exposeHeaders: ["EXPOSED-HEADER"],
        credentials: false,
        maxAge: "12345",
        preflight: {
          statusCode: 404,
        },
      });
    });

    describe("credentials warnings", () => {
      // `resolveCorsOptions` runs on every request and warns at most once per
      // process (warn-once dedup), so reset module state between tests to
      // observe each warning in isolation.
      let resolveCorsOptions: (typeof import("../../src/utils/internal/cors.ts"))["resolveCorsOptions"];
      beforeEach(async () => {
        vi.resetModules();
        ({ resolveCorsOptions } = await import("../../src/utils/internal/cors.ts"));
      });

      it("warns when credentials is used with wildcard origin", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        resolveCorsOptions({ credentials: true, exposeHeaders: ["X-Custom"] });
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0][0]).toContain("origin");

        warnSpy.mockRestore();
      });

      it("warns when credentials is used with default wildcard exposeHeaders", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        resolveCorsOptions({
          credentials: true,
          origin: ["https://example.com"],
        });
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0][0]).toContain("exposeHeaders");

        warnSpy.mockRestore();
      });

      it("warns when credentials is used with an explicit wildcard exposeHeaders", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        resolveCorsOptions({
          credentials: true,
          origin: ["https://example.com"],
          exposeHeaders: "*",
        });
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0][0]).toContain("exposeHeaders");

        warnSpy.mockRestore();
      });

      it("does not warn when credentials is properly configured", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        resolveCorsOptions({
          credentials: true,
          origin: ["https://example.com"],
          exposeHeaders: ["X-Custom"],
        });
        expect(warnSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
      });

      it("does not warn when credentials is false", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        resolveCorsOptions({ credentials: false, origin: "*" });
        expect(warnSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
      });

      it("warns at most once per message across repeated calls", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        // Default origin + exposeHeaders are both wildcard → two distinct messages.
        resolveCorsOptions({ credentials: true });
        resolveCorsOptions({ credentials: true });
        expect(warnSpy).toHaveBeenCalledTimes(2);

        warnSpy.mockRestore();
      });
    });
  });

  describe("isPreflightRequest", () => {
    it("can detect preflight request", () => {
      const eventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
          "access-control-request-method": "GET",
        },
      });

      expect(isPreflightRequest(eventMock)).toEqual(true);
    });

    it("can detect request of non-OPTIONS method)", () => {
      const eventMock = mockEvent("/", {
        method: "GET",
        headers: {
          origin: "https://example.com",
          "access-control-request-method": "GET",
        },
      });

      expect(isPreflightRequest(eventMock)).toEqual(false);
    });

    it("can detect request without origin header", () => {
      const eventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {
          "access-control-request-method": "GET",
        },
      });

      expect(isPreflightRequest(eventMock)).toEqual(false);
    });

    it("can detect request without AccessControlRequestMethod header", () => {
      const eventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
        },
      });

      expect(isPreflightRequest(eventMock)).toEqual(false);
    });
  });

  describe("isCorsOriginAllowed", () => {
    it("returns `false` if `origin` header is not defined", () => {
      const origin = undefined;
      const options: CorsOptions = {};

      expect(isCorsOriginAllowed(origin, options)).toEqual(false);
    });

    it("returns `true` if `origin` option is not defined", () => {
      const origin = "https://example.com";
      const options: CorsOptions = {};

      expect(isCorsOriginAllowed(origin, options)).toEqual(true);
    });

    it('returns `true` if `origin` option is `"*"`', () => {
      const origin = "https://example.com";
      const options: CorsOptions = {
        origin: "*",
      };

      expect(isCorsOriginAllowed(origin, options)).toEqual(true);
    });

    it('returns `false` if `origin` option is `"null"`', () => {
      const origin = "https://example.com";
      const options: CorsOptions = {
        origin: "null",
      };

      expect(isCorsOriginAllowed(origin, options)).toEqual(false);
    });

    it("can detect allowed origin (string)", () => {
      const origin = "https://example.com";
      const options: CorsOptions = {
        origin: ["https://example.com"],
      };

      expect(isCorsOriginAllowed(origin, options)).toEqual(true);
    });

    it("can detect allowed origin (regular expression)", () => {
      const options: CorsOptions = {
        // Regex origins are matched unanchored, so they MUST be anchored and
        // escaped to avoid matching attacker-controlled origins like
        // `https://example.com.evil.test` or `https://notexample.com`.
        origin: [/^https:\/\/([a-z0-9-]+\.)?example\.com$/],
      };

      expect(isCorsOriginAllowed("https://example.com", options)).toEqual(true);
      expect(isCorsOriginAllowed("https://sub.example.com", options)).toEqual(true);
    });

    it("rejects origins that a properly anchored regex must not match", () => {
      const options: CorsOptions = {
        origin: [/^https:\/\/([a-z0-9-]+\.)?example\.com$/],
      };

      // A regression to an unanchored regex would allow these.
      expect(isCorsOriginAllowed("https://example.com.evil.test", options)).toEqual(false);
      expect(isCorsOriginAllowed("https://notexample.com", options)).toEqual(false);
    });

    it("can detect allowed origin (function)", () => {
      const origin = "https://example.com";
      const options: CorsOptions = {
        origin: (_origin: string) => {
          expect(_origin).toEqual(origin);
          return true;
        },
      };

      expect(isCorsOriginAllowed(origin, options)).toEqual(true);
    });

    it("can detect allowed origin (falsy)", () => {
      const origin = "https://example.com";
      const options: CorsOptions = {
        origin: ["https://example2.com"],
      };

      expect(isCorsOriginAllowed(origin, options)).toEqual(false);
    });
  });

  describe("createOriginHeaders", () => {
    it('returns an object whose `access-control-allow-origin` is `"*"` if `origin` option is not defined, or `"*"`', () => {
      const hasOriginEventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
        },
      });
      const noOriginEventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {},
      });
      const defaultOptions: CorsOptions = {};
      const originWildcardOptions: CorsOptions = {
        origin: "*",
      };

      expect(createOriginHeaders(hasOriginEventMock, defaultOptions)).toEqual({
        "access-control-allow-origin": "*",
      });
      expect(createOriginHeaders(hasOriginEventMock, originWildcardOptions)).toEqual({
        "access-control-allow-origin": "*",
      });
      expect(createOriginHeaders(noOriginEventMock, defaultOptions)).toEqual({
        "access-control-allow-origin": "*",
      });
      expect(createOriginHeaders(noOriginEventMock, originWildcardOptions)).toEqual({
        "access-control-allow-origin": "*",
      });
    });

    it("does not emit allow-origin for regex-boundary attacker origins", () => {
      const options: CorsOptions = {
        origin: [/^https:\/\/([a-z0-9-]+\.)?example\.com$/],
      };
      const allowedEventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: { origin: "https://example.com" },
      });
      const evilSuffixEventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: { origin: "https://example.com.evil.test" },
      });
      const notExampleEventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: { origin: "https://notexample.com" },
      });

      expect(createOriginHeaders(allowedEventMock, options)).toEqual({
        "access-control-allow-origin": "https://example.com",
        vary: "origin",
      });
      expect(createOriginHeaders(evilSuffixEventMock, options)).toEqual({
        vary: "origin",
      });
      expect(createOriginHeaders(notExampleEventMock, options)).toEqual({
        vary: "origin",
      });
    });

    it('handles `"null"` origin option consistently with `isCorsOriginAllowed`', () => {
      const nullOriginEventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {
          origin: "null",
        },
      });
      const otherOriginEventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
        },
      });
      const options: CorsOptions = {
        origin: "null",
      };

      expect(createOriginHeaders(nullOriginEventMock, options)).toEqual({
        "access-control-allow-origin": "null",
        vary: "origin",
      });
      expect(createOriginHeaders(otherOriginEventMock, options)).toEqual({
        vary: "origin",
      });
    });

    it("returns an object with `access-control-allow-origin` and `vary` keys if `origin` option and `origin` header matches", () => {
      const eventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {
          origin: "http://example.com",
        },
      });
      const noMatchEventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {
          origin: "http://example.test",
        },
      });
      const options1: CorsOptions = {
        origin: ["http://example.com"],
      };
      const options2: CorsOptions = {
        // Anchored and escaped so it matches the exact origin only, not e.g.
        // `http://example.com.evil.test`.
        origin: [/^https?:\/\/example\.com$/],
      };

      expect(createOriginHeaders(eventMock, options1)).toEqual({
        "access-control-allow-origin": "http://example.com",
        vary: "origin",
      });
      expect(createOriginHeaders(noMatchEventMock, options1)).toEqual({
        vary: "origin",
      });
      expect(createOriginHeaders(eventMock, options2)).toEqual({
        "access-control-allow-origin": "http://example.com",
        vary: "origin",
      });
      expect(createOriginHeaders(noMatchEventMock, options2)).toEqual({
        vary: "origin",
      });
    });

    it("returns only `vary` if `origin` option is one that is not allowed", () => {
      const eventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
        },
      });
      const options1: CorsOptions = {
        origin: ["http://example2.com"],
      };
      const options2: CorsOptions = {
        origin: () => false,
      };

      expect(createOriginHeaders(eventMock, options1)).toEqual({ vary: "origin" });
      expect(createOriginHeaders(eventMock, options2)).toEqual({ vary: "origin" });
    });

    it("returns only `vary` if `origin` option is not wildcard and `origin` header is not defined", () => {
      const eventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {},
      });
      const options1: CorsOptions = {
        origin: ["http://example.com"],
      };
      const options2: CorsOptions = {
        origin: () => false,
      };

      expect(createOriginHeaders(eventMock, options1)).toEqual({ vary: "origin" });
      expect(createOriginHeaders(eventMock, options2)).toEqual({ vary: "origin" });
    });
  });

  describe("createMethodsHeaders", () => {
    const eventMock = mockEvent("/", {
      method: "OPTIONS",
      headers: {
        "access-control-request-method": "POST",
      },
    });

    it("returns an empty object if `methods` option is not defined or an empty array", () => {
      const options1: CorsOptions = {};
      const options2: CorsOptions = {
        methods: [],
      };

      expect(createMethodsHeaders(eventMock, options1)).toEqual({});
      expect(createMethodsHeaders(eventMock, options2)).toEqual({});
    });

    it('returns an object whose `access-control-allow-methods` is `"*"` if `methods` option is `"*"`', () => {
      const options1: CorsOptions = {
        methods: "*",
      };

      expect(createMethodsHeaders(eventMock, options1)).toEqual({
        "access-control-allow-methods": "*",
      });
    });

    it('reflects the requested method if `methods` option is `"*"` and `credentials` is enabled', () => {
      const options: CorsOptions = {
        methods: "*",
        credentials: true,
      };

      expect(createMethodsHeaders(eventMock, options)).toEqual({
        "access-control-allow-methods": "POST",
        vary: "access-control-request-method",
      });

      const noRequestMethodEventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {},
      });
      expect(createMethodsHeaders(noRequestMethodEventMock, options)).toEqual({});
    });

    it("returns an object whose `access-control-allow-methods` is set as `methods` option", () => {
      const options: CorsOptions = {
        methods: ["GET", "POST"],
      };

      expect(createMethodsHeaders(eventMock, options)).toEqual({
        "access-control-allow-methods": "GET,POST",
      });
    });
  });

  describe("createCredentialsHeaders", () => {
    it("returns an empty object if `credentials` option is not defined", () => {
      const options: CorsOptions = {};

      expect(createCredentialsHeaders(options)).toEqual({});
    });

    it('returns an object whose `access-control-allow-credentials` is `"true"` if `credentials` option is true', () => {
      const options: CorsOptions = {
        credentials: true,
      };

      expect(createCredentialsHeaders(options)).toEqual({
        "access-control-allow-credentials": "true",
      });
    });
  });

  describe("createAllowHeaderHeaders", () => {
    it('returns an object with `access-control-allow-headers` and `vary` keys according to `access-control-request-headers` header if `allowHeaders` option is not defined, `"*"`, or an empty array', () => {
      const eventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {
          "access-control-request-headers": "CUSTOM-HEADER",
        },
      });
      const options1: CorsOptions = {};
      const options2: CorsOptions = {
        allowHeaders: "*",
      };
      const options3: CorsOptions = {
        allowHeaders: [],
      };

      expect(createAllowHeaderHeaders(eventMock, options1)).toEqual({
        "access-control-allow-headers": "CUSTOM-HEADER",
        vary: "access-control-request-headers",
      });
      expect(createAllowHeaderHeaders(eventMock, options2)).toEqual({
        "access-control-allow-headers": "CUSTOM-HEADER",
        vary: "access-control-request-headers",
      });
      expect(createAllowHeaderHeaders(eventMock, options3)).toEqual({
        "access-control-allow-headers": "CUSTOM-HEADER",
        vary: "access-control-request-headers",
      });
    });

    it("returns an object with `access-control-allow-headers` and `vary` keys according to `allowHeaders` option if `access-control-request-headers` header is not defined", () => {
      const eventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {},
      });
      const options: CorsOptions = {
        allowHeaders: ["CUSTOM-HEADER"],
      };

      expect(createAllowHeaderHeaders(eventMock, options)).toEqual({
        "access-control-allow-headers": "CUSTOM-HEADER",
        vary: "access-control-request-headers",
      });
    });

    it('returns only `vary` if `allowHeaders` option is not defined, `"*"`, or an empty array, and `access-control-request-headers` is not defined', () => {
      const eventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {},
      });
      const options1: CorsOptions = {};
      const options2: CorsOptions = {
        allowHeaders: "*",
      };
      const options3: CorsOptions = {
        allowHeaders: [],
      };

      const expected = { vary: "access-control-request-headers" };
      expect(createAllowHeaderHeaders(eventMock, options1)).toEqual(expected);
      expect(createAllowHeaderHeaders(eventMock, options2)).toEqual(expected);
      expect(createAllowHeaderHeaders(eventMock, options3)).toEqual(expected);
    });
  });

  describe("createExposeHeaders", () => {
    it("returns an object if `exposeHeaders` option is not defined", () => {
      const options: CorsOptions = {};

      expect(createExposeHeaders(options)).toEqual({});
    });

    it("returns an object with `access-control-expose-headers` key according to `exposeHeaders` option", () => {
      const options1: CorsOptions = {
        exposeHeaders: "*",
      };
      const options2: CorsOptions = {
        exposeHeaders: ["EXPOSED-HEADER-1", "EXPOSED-HEADER-2"],
      };

      expect(createExposeHeaders(options1)).toEqual({
        "access-control-expose-headers": "*",
      });
      expect(createExposeHeaders(options2)).toEqual({
        "access-control-expose-headers": "EXPOSED-HEADER-1,EXPOSED-HEADER-2",
      });
    });

    it('omits the header if `exposeHeaders` option is `"*"` and `credentials` is enabled', () => {
      const options: CorsOptions = {
        exposeHeaders: "*",
        credentials: true,
      };

      expect(createExposeHeaders(options)).toEqual({});
    });
  });

  describe("createMaxAgeHeader", () => {
    it("returns an object if `maxAge` option is not defined, false, or an empty string", () => {
      const options1: CorsOptions = {};
      const options2: CorsOptions = {
        maxAge: false,
      };
      const options3: CorsOptions = {
        maxAge: "",
      };

      expect(createMaxAgeHeader(options1)).toEqual({});
      expect(createMaxAgeHeader(options2)).toEqual({});
      expect(createMaxAgeHeader(options3)).toEqual({});
    });

    it("returns an object with `access-control-max-age` key according to `exposeHeaders` option", () => {
      const options1: CorsOptions = {
        maxAge: "12345",
      };
      const options2: CorsOptions = {
        maxAge: "0",
      };

      expect(createMaxAgeHeader(options1)).toEqual({
        "access-control-max-age": "12345",
      });
      expect(createMaxAgeHeader(options2)).toEqual({
        "access-control-max-age": "0",
      });
    });
  });

  describe("appendCorsPreflightHeaders", () => {
    it("append CORS headers with preflight request", () => {
      {
        const eventMock = mockEvent("/", {
          method: "OPTIONS",
          headers: {
            origin: "https://example.com",
            "access-control-request-method": "GET",
            "access-control-request-headers": "CUSTOM-HEADER",
          },
        });
        // default options
        const options: CorsOptions = {
          origin: "*",
          methods: "*",
          allowHeaders: "*",
          exposeHeaders: "*",
          credentials: false,
          maxAge: false,
          preflight: {
            statusCode: 204,
          },
        };

        appendCorsPreflightHeaders(eventMock, options);

        expect(eventMock.res.headers.get("access-control-allow-origin")).toEqual("*");
        expect(eventMock.res.headers.has("access-control-allow-credentials")).toEqual(false);
        expect(eventMock.res.headers.get("access-control-allow-methods")).toEqual("*");
        expect(eventMock.res.headers.get("access-control-allow-headers")).toEqual("CUSTOM-HEADER");
        expect(eventMock.res.headers.get("vary")).toEqual("access-control-request-headers");
        expect(eventMock.res.headers.has("access-control-max-age")).toEqual(false);
      }

      {
        const eventMock = mockEvent("/", {
          method: "OPTIONS",
          headers: {
            origin: "https://example.com",
            "access-control-request-method": "GET",
            "access-control-request-headers": "CUSTOM-HEADER",
          },
        });
        // exposeHeaders and maxAge
        const options: CorsOptions = {
          origin: "*",
          exposeHeaders: ["EXPOSE-HEADER", "Authorization"],
          maxAge: "12345",
        };

        appendCorsPreflightHeaders(eventMock, options);

        expect(eventMock.res.headers.get("access-control-allow-origin")).toEqual("*");
        expect(eventMock.res.headers.has("access-control-allow-credentials")).toEqual(false);
        expect(eventMock.res.headers.has("access-control-allow-methods")).toEqual(false);
        expect(eventMock.res.headers.get("access-control-allow-headers")).toEqual("CUSTOM-HEADER");
        expect(eventMock.res.headers.get("vary")).toEqual("access-control-request-headers");
        expect(eventMock.res.headers.get("access-control-max-age")).toEqual("12345");
      }

      {
        const eventMock = mockEvent("/", {
          method: "OPTIONS",
          headers: {
            origin: "https://example.com",
            "access-control-request-method": "GET",
          },
        });
        // credentials
        const options: CorsOptions = {
          origin: ["https://example.com"],
          credentials: true,
        };

        appendCorsPreflightHeaders(eventMock, options);

        expect(eventMock.res.headers.get("access-control-allow-origin")).toEqual(
          "https://example.com",
        );
        expect(eventMock.res.headers.get("vary")).toEqual("origin, access-control-request-headers");
        expect(eventMock.res.headers.get("access-control-allow-credentials")).toEqual("true");
        expect(eventMock.res.headers.has("access-control-allow-methods")).toEqual(false);
        expect(eventMock.res.headers.has("access-control-allow-headers")).toEqual(false);
        expect(eventMock.res.headers.has("access-control-max-age")).toEqual(false);
      }

      {
        // credentials + wildcard methods: the requested method is reflected
        // (browsers treat a literal `*` as a method name on credentialed requests)
        const eventMock = mockEvent("/", {
          method: "OPTIONS",
          headers: {
            origin: "https://example.com",
            "access-control-request-method": "PUT",
          },
        });
        const options: CorsOptions = {
          origin: ["https://example.com"],
          methods: "*",
          credentials: true,
        };

        appendCorsPreflightHeaders(eventMock, options);

        expect(eventMock.res.headers.get("access-control-allow-methods")).toEqual("PUT");
        const vary = eventMock.res.headers.get("vary") ?? "";
        expect(vary).toContain("origin");
        expect(vary).toContain("access-control-request-method");
      }

      {
        // Both createOriginHeaders (origin allowlist) and createAllowHeaderHeaders (wildcard)
        // independently emit a `vary` key. The spread must merge them, not overwrite.
        const eventMock = mockEvent("/", {
          method: "OPTIONS",
          headers: {
            origin: "https://example.com",
            "access-control-request-method": "GET",
            "access-control-request-headers": "CUSTOM-HEADER",
          },
        });
        const options: CorsOptions = {
          origin: ["https://example.com"],
          allowHeaders: "*",
        };

        appendCorsPreflightHeaders(eventMock, options);

        const vary = eventMock.res.headers.get("vary") ?? "";
        expect(vary).toContain("origin");
        expect(vary).toContain("access-control-request-headers");
      }
    });
  });

  describe("appendCorsHeaders", () => {
    it("append CORS headers with CORS request", () => {
      {
        const eventMock = mockEvent("/", {
          method: "GET",
          headers: {
            origin: "https://example.com",
            "CUSTOM-HEADER": "CUSTOM-HEADER-VALUE",
          },
        });
        // default options
        const options: CorsOptions = {
          origin: "*",
          methods: "*",
          allowHeaders: "*",
          exposeHeaders: "*",
          credentials: false,
          maxAge: false,
          preflight: {
            statusCode: 204,
          },
        };

        appendCorsHeaders(eventMock, options);

        expect(eventMock.res.headers.get("access-control-allow-origin")).toEqual("*");
        expect(eventMock.res.headers.has("access-control-allow-credentials")).toEqual(false);
        expect(eventMock.res.headers.get("access-control-expose-headers")).toEqual("*");
      }

      {
        const eventMock = mockEvent("/", {
          method: "GET",
          headers: {
            origin: "https://example.com",
          },
        });
        // exposeHeaders and maxAge
        const options: CorsOptions = {
          origin: "*",
          exposeHeaders: ["EXPOSE-HEADER", "Authorization"],
          maxAge: "12345",
        };

        appendCorsHeaders(eventMock, options);

        expect(eventMock.res.headers.get("access-control-allow-origin")).toEqual("*");
        expect(eventMock.res.headers.has("access-control-allow-credentials")).toEqual(false);
        expect(eventMock.res.headers.get("access-control-expose-headers")).toEqual(
          "EXPOSE-HEADER,Authorization",
        );
      }

      {
        const eventMock = mockEvent("/", {
          method: "GET",
          headers: {
            origin: "https://example.com",
          },
        });
        // credentials
        const options: CorsOptions = {
          origin: ["https://example.com"],
          credentials: true,
        };

        appendCorsHeaders(eventMock, options);

        expect(eventMock.res.headers.get("access-control-allow-origin")).toEqual(
          "https://example.com",
        );
        expect(eventMock.res.headers.get("vary")).toEqual("origin");
        expect(eventMock.res.headers.get("access-control-allow-credentials")).toEqual("true");
      }
    });

    it("adds `vary: origin` even when the origin is not allowed", () => {
      // Without `vary: origin`, a shared cache could store this response (which
      // has no `access-control-allow-origin`) and serve it to an allowed origin.
      const eventMock = mockEvent("/", {
        method: "GET",
        headers: {
          origin: "https://evil.example",
        },
      });

      appendCorsHeaders(eventMock, {
        origin: ["https://example.com"],
      });

      expect(eventMock.res.headers.has("access-control-allow-origin")).toEqual(false);
      expect(eventMock.res.headers.get("vary")).toEqual("origin");
    });
  });

  describe("handleCors", () => {
    it("handles preflight request", () => {
      const eventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
          "access-control-request-method": "POST",
        },
      });

      // use defaults
      handleCors(eventMock, {});

      expect(eventMock.res.headers.get("access-control-allow-origin")).toEqual("*");
      expect(eventMock.res.headers.get("access-control-allow-methods")).toEqual("*");
      expect(eventMock.res.headers.has("access-control-expose-headers")).toEqual(false);
    });

    it("handles normal request", () => {
      const eventMock = mockEvent("/", {
        method: "POST",
        headers: {
          origin: "https://example.com",
        },
      });

      // use defaults
      handleCors(eventMock, {});

      expect(eventMock.res.headers.get("access-control-allow-origin")).toEqual("*");
      expect(eventMock.res.headers.has("access-control-allow-methods")).toEqual(false);
      expect(eventMock.res.headers.get("access-control-expose-headers")).toEqual("*");
    });

    it("preserves CORS headers on HTTPError responses", async () => {
      const eventMock = mockEvent("/", {
        method: "POST",
        headers: {
          origin: "https://example.com",
        },
      });

      handleCors(eventMock, {
        origin: ["https://example.com"],
      });

      const error = new HTTPError("Invalid Password!");
      const response = await toResponse(error, eventMock);

      expect(response.status).toBe(500);
      expect(response.headers.get("access-control-allow-origin")).toEqual("https://example.com");
    });
  });
});
