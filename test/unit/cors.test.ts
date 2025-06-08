import { expect, it, describe } from "vitest";
import {
  mockEvent,
  isPreflightRequest,
  isCorsOriginAllowed,
  appendCorsPreflightHeaders,
  appendCorsHeaders,
} from "../../src/index.ts";
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
      const origin = "https://example.com";
      const options: CorsOptions = {
        origin: [/example/],
      };

      expect(isCorsOriginAllowed(origin, options)).toEqual(true);
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
      expect(
        createOriginHeaders(hasOriginEventMock, originWildcardOptions),
      ).toEqual({
        "access-control-allow-origin": "*",
      });
      expect(createOriginHeaders(noOriginEventMock, defaultOptions)).toEqual({
        "access-control-allow-origin": "*",
      });
      expect(
        createOriginHeaders(noOriginEventMock, originWildcardOptions),
      ).toEqual({
        "access-control-allow-origin": "*",
      });
    });

    it('returns an object with `access-control-allow-origin` and `vary` keys if `origin` option is `"null"`', () => {
      const eventMock = mockEvent("/", {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
        },
      });
      const options: CorsOptions = {
        origin: "null",
      };

      expect(createOriginHeaders(eventMock, options)).toEqual({
        "access-control-allow-origin": "null",
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
        origin: [/example.com/],
      };

      expect(createOriginHeaders(eventMock, options1)).toEqual({
        "access-control-allow-origin": "http://example.com",
        vary: "origin",
      });
      expect(createOriginHeaders(noMatchEventMock, options1)).toEqual({});
      expect(createOriginHeaders(eventMock, options2)).toEqual({
        "access-control-allow-origin": "http://example.com",
        vary: "origin",
      });
      expect(createOriginHeaders(noMatchEventMock, options2)).toEqual({});
    });

    it("returns an empty object if `origin` option is one that is not allowed", () => {
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

      expect(createOriginHeaders(eventMock, options1)).toEqual({});
      expect(createOriginHeaders(eventMock, options2)).toEqual({});
    });

    it("returns an empty object if `origin` option is not wildcard and `origin` header is not defined", () => {
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

      expect(createOriginHeaders(eventMock, options1)).toEqual({});
      expect(createOriginHeaders(eventMock, options2)).toEqual({});
    });
  });

  describe("createMethodsHeaders", () => {
    it("returns an empty object if `methods` option is not defined or an empty array", () => {
      const options1: CorsOptions = {};
      const options2: CorsOptions = {
        methods: [],
      };

      expect(createMethodsHeaders(options1)).toEqual({});
      expect(createMethodsHeaders(options2)).toEqual({});
    });

    it('returns an object whose `access-control-allow-methods` is `"*"` if `methods` option is `"*"`', () => {
      const options1: CorsOptions = {
        methods: "*",
      };

      expect(createMethodsHeaders(options1)).toEqual({
        "access-control-allow-methods": "*",
      });
    });

    it("returns an object whose `access-control-allow-methods` is set as `methods` option", () => {
      const options: CorsOptions = {
        methods: ["GET", "POST"],
      };

      expect(createMethodsHeaders(options)).toEqual({
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

    it('returns an empty object if `allowHeaders` option is not defined, `"*"`, or an empty array, and `access-control-request-headers` is not defined', () => {
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

      expect(createAllowHeaderHeaders(eventMock, options1)).toEqual({});
      expect(createAllowHeaderHeaders(eventMock, options2)).toEqual({});
      expect(createAllowHeaderHeaders(eventMock, options3)).toEqual({});
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

        expect(
          eventMock.res.headers.get("access-control-allow-origin"),
        ).toEqual("*");
        expect(
          eventMock.res.headers.has("access-control-allow-credentials"),
        ).toEqual(false);
        expect(
          eventMock.res.headers.get("access-control-allow-methods"),
        ).toEqual("*");
        expect(
          eventMock.res.headers.get("access-control-allow-headers"),
        ).toEqual("CUSTOM-HEADER");
        expect(eventMock.res.headers.get("vary")).toEqual(
          "access-control-request-headers",
        );
        expect(eventMock.res.headers.has("access-control-max-age")).toEqual(
          false,
        );
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

        expect(
          eventMock.res.headers.get("access-control-allow-origin"),
        ).toEqual("*");
        expect(
          eventMock.res.headers.has("access-control-allow-credentials"),
        ).toEqual(false);
        expect(
          eventMock.res.headers.has("access-control-allow-methods"),
        ).toEqual(false);
        expect(
          eventMock.res.headers.get("access-control-allow-headers"),
        ).toEqual("CUSTOM-HEADER");
        expect(eventMock.res.headers.get("vary")).toEqual(
          "access-control-request-headers",
        );
        expect(eventMock.res.headers.get("access-control-max-age")).toEqual(
          "12345",
        );
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

        expect(
          eventMock.res.headers.get("access-control-allow-origin"),
        ).toEqual("https://example.com");
        expect(eventMock.res.headers.get("vary")).toEqual("origin");
        expect(
          eventMock.res.headers.get("access-control-allow-credentials"),
        ).toEqual("true");
        expect(
          eventMock.res.headers.has("access-control-allow-methods"),
        ).toEqual(false);
        expect(
          eventMock.res.headers.has("access-control-allow-headers"),
        ).toEqual(false);
        expect(eventMock.res.headers.has("access-control-max-age")).toEqual(
          false,
        );
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

        expect(
          eventMock.res.headers.get("access-control-allow-origin"),
        ).toEqual("*");
        expect(
          eventMock.res.headers.has("access-control-allow-credentials"),
        ).toEqual(false);
        expect(
          eventMock.res.headers.get("access-control-expose-headers"),
        ).toEqual("*");
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

        expect(
          eventMock.res.headers.get("access-control-allow-origin"),
        ).toEqual("*");
        expect(
          eventMock.res.headers.has("access-control-allow-credentials"),
        ).toEqual(false);
        expect(
          eventMock.res.headers.get("access-control-expose-headers"),
        ).toEqual("EXPOSE-HEADER,Authorization");
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

        expect(
          eventMock.res.headers.get("access-control-allow-origin"),
        ).toEqual("https://example.com");
        expect(eventMock.res.headers.get("vary")).toEqual("origin");
        expect(
          eventMock.res.headers.get("access-control-allow-credentials"),
        ).toEqual("true");
      }
    });
  });
});
