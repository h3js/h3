import { describe, it, expect } from "vitest";
import { tracingChannel } from "node:diagnostics_channel";
import { describeMatrix, type TestOptions } from "./_setup.ts";
import { H3 } from "../src/h3.ts";
import { tracingPlugin, type TracingRequestEvent } from "../src/tracing.ts";
import { HTTPError } from "../src/error.ts";

type TracingEvent = {
  start?: { data: TracingRequestEvent };
  end?: { data: TracingRequestEvent };
  asyncStart?: { data: TracingRequestEvent };
  asyncEnd?: { data: TracingRequestEvent; result?: any; error?: Error };
  error?: { data: TracingRequestEvent; error: Error };
};

function createTracingListener() {
  const events: TracingEvent[] = [];

  const tracingCh = tracingChannel("h3.request");

  const startHandler = (message: any) => {
    events.push({ start: { data: message } });
  };
  const endHandler = (message: any) => {
    events.push({ end: { data: message } });
  };
  const asyncStartHandler = (message: any) => {
    events.push({ asyncStart: { data: message } });
  };
  const asyncEndHandler = (message: any) => {
    events.push({
      asyncEnd: { data: message, result: message.result, error: message.error },
    });
  };
  const errorHandler = (message: any) => {
    events.push({ error: { data: message, error: message.error } });
  };

  tracingCh.subscribe({
    start: startHandler,
    end: endHandler,
    asyncStart: asyncStartHandler,
    asyncEnd: asyncEndHandler,
    error: errorHandler,
  });

  return {
    events,
    cleanup: () => {
      tracingCh.unsubscribe({
        start: startHandler,
        end: endHandler,
        asyncStart: asyncStartHandler,
        asyncEnd: asyncEndHandler,
        error: errorHandler,
      });
    },
  };
}

// Matrix is configured with tracing plugin enabled
const testOpts: TestOptions = { tracing: true };

describeMatrix(
  "tracing channels",
  (t, { it, expect }) => {
    it("tracing channels fire for handlers", async () => {
      const listener = createTracingListener();

      try {
        t.app.get("/test", () => "response");
        const response = await t.fetch("/test");

        // Tracing events fire asynchronously after the response
        expect(listener.events.length).toBeGreaterThan(0);

        // Verify response was successful
        expect(response.status).toBe(200);

        // Should have asyncStart and asyncEnd events
        const asyncStarts = listener.events.filter((e) => e.asyncStart);
        const asyncEnds = listener.events.filter((e) => e.asyncEnd);

        expect(asyncStarts.length).toBeGreaterThan(0);
        expect(asyncEnds.length).toBeGreaterThan(0);

        // Should have events for route handler
        const routeEvents = listener.events.filter(
          (e) => e.asyncStart?.data.type === "route" || e.asyncEnd?.data.type === "route",
        );
        expect(routeEvents.length).toBeGreaterThan(0);

        // Verify payload structure
        const firstStart = asyncStarts[0];
        expect(firstStart.asyncStart?.data.event.req).toBeDefined();
        expect(firstStart.asyncStart?.data.event).toBeDefined();
      } finally {
        listener.cleanup();
      }
    });

    it("tracing channels fire completion events", async () => {
      const listener = createTracingListener();

      try {
        t.app.get("/test", () => "response");
        await t.fetch("/test");

        // Wait for tracing events to be processed
        expect(listener.events.length).toBeGreaterThan(0);

        const asyncStarts = listener.events.filter((e) => e.asyncStart);
        const asyncEnds = listener.events.filter((e) => e.asyncEnd);

        // Should have matching start/end events
        expect(asyncStarts.length).toBeGreaterThan(0);
        expect(asyncEnds.length).toBeGreaterThan(0);
        expect(asyncStarts.length).toBe(asyncEnds.length);
      } finally {
        listener.cleanup();
      }
    });

    it("tracing:h3.request:asyncStart/asyncEnd fire for async handlers", async () => {
      const listener = createTracingListener();

      try {
        t.app.get("/async", async () => {
          await Promise.resolve();
          return "async response";
        });

        await t.fetch("/async");

        // Wait for tracing events to be processed
        expect(listener.events.length).toBeGreaterThan(0);

        const asyncStarts = listener.events.filter((e) => e.asyncStart);
        const asyncEnds = listener.events.filter((e) => e.asyncEnd);

        expect(asyncStarts.length).toBeGreaterThan(0);
        expect(asyncEnds.length).toBeGreaterThan(0);

        const routeStart = asyncStarts.find((e) => e.asyncStart?.data.type === "route");
        const routeEnd = asyncEnds.find((e) => e.asyncEnd?.data.type === "route");

        expect(routeStart).toBeDefined();
        expect(routeEnd).toBeDefined();
      } finally {
        listener.cleanup();
      }
    });

    it("tracing:h3.request:error fires when handler throws", async () => {
      const listener = createTracingListener();

      // Disable the test error handler so we can see the tracing error event
      const originalOnError = t.hooks.onError;
      t.hooks.onError.mockImplementation(() => {
        // Silence error - we're testing the tracing channel
      });

      try {
        t.app.get("/error", () => {
          throw new HTTPError("Handler error");
        });

        await t.fetch("/error");

        // Wait for tracing events to be processed
        expect(listener.events.length).toBeGreaterThan(0);

        const errorEvents = listener.events.filter((e) => e.error);
        expect(errorEvents.length).toBeGreaterThan(0);
        expect(errorEvents[0].error?.error.message).toBe("Handler error");
      } finally {
        listener.cleanup();
        t.hooks.onError = originalOnError;
      }
    });

    it("middleware executions are traced with type='middleware'", async () => {
      const listener = createTracingListener();

      try {
        t.app.use((event) => {
          event.context.middleware1 = true;
        });

        t.app.use((event) => {
          event.context.middleware2 = true;
        });

        t.app.get("/test", () => "response");

        await t.fetch("/test");

        const allStarts = listener.events.filter((e) => e.asyncStart);
        const middlewareEvents = allStarts.filter((e) => e.asyncStart?.data.type === "middleware");
        const routeEvents = allStarts.filter((e) => e.asyncStart?.data.type === "route");

        expect(middlewareEvents.length).toBeGreaterThanOrEqual(2);
        expect(routeEvents.length).toBeGreaterThanOrEqual(1);
      } finally {
        listener.cleanup();
      }
    });

    it("each middleware gets its own traced execution", async () => {
      const listener = createTracingListener();

      try {
        t.app.use(() => {}); // Middleware 1
        t.app.use(() => {}); // Middleware 2
        t.app.get("/test", () => "done"); // Route

        await t.fetch("/test");

        const middlewareStarts = listener.events.filter(
          (e) => e.asyncStart?.data.type === "middleware",
        );
        const middlewareEnds = listener.events.filter(
          (e) => e.asyncEnd?.data.type === "middleware",
        );

        expect(middlewareStarts.length).toBe(2);
        expect(middlewareEnds.length).toBe(2);
      } finally {
        listener.cleanup();
      }
    });

    it("request and event objects are included in tracing payloads", async () => {
      const listener = createTracingListener();

      try {
        t.app.get("/test", () => "response");
        const res = await t.fetch("/test?foo=bar");
        expect(res.status).toBe(200);

        // Wait for tracing events to be processed
        expect(listener.events.length).toBeGreaterThan(0);

        const asyncStarts = listener.events.filter((e) => e.asyncStart);
        expect(asyncStarts.length).toBeGreaterThan(0);

        const firstEvent = asyncStarts[0].asyncStart!.data;
        expect(firstEvent.event).toBeDefined();
        expect(firstEvent.event.url).toBeDefined();
        expect(firstEvent.event.req.method).toBe("GET");
        expect(firstEvent.event.url.pathname).toBe("/test");
      } finally {
        listener.cleanup();
      }
    });

    it("tracing doesn't interfere with normal request flow", async () => {
      const listener = createTracingListener();

      try {
        t.app.get("/test", (event) => ({
          method: event.req.method,
          path: event.url.pathname,
        }));

        const res = await t.fetch("/test");
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.method).toBe("GET");
        expect(body.path).toBe("/test");
      } finally {
        listener.cleanup();
      }
    });

    it("middleware chain tracing with route handler", async () => {
      const listener = createTracingListener();

      try {
        t.app.use((event) => {
          event.context.step1 = true;
        });

        t.app.use((event) => {
          event.context.step2 = true;
        });

        t.app.get("/chain", (event) => ({
          step1: event.context.step1,
          step2: event.context.step2,
        }));

        const res = await t.fetch("/chain");
        expect(res.status).toBe(200);

        const middlewareStarts = listener.events.filter(
          (e) => e.asyncStart?.data.type === "middleware",
        );
        const middlewareEnds = listener.events.filter(
          (e) => e.asyncEnd?.data.type === "middleware",
        );
        const routeStarts = listener.events.filter((e) => e.asyncStart?.data.type === "route");
        const routeEnds = listener.events.filter((e) => e.asyncEnd?.data.type === "route");

        expect(middlewareStarts.length).toBe(2);
        expect(middlewareEnds.length).toBe(2);
        expect(routeStarts.length).toBe(1);
        expect(routeEnds.length).toBe(1);
      } finally {
        listener.cleanup();
      }
    });

    it("async middleware tracing", async () => {
      const listener = createTracingListener();

      try {
        t.app.use(async (event) => {
          await Promise.resolve();
          event.context.asyncMiddleware = true;
        });

        t.app.get("/async", async (event) => {
          await Promise.resolve();
          return { asyncMiddleware: event.context.asyncMiddleware };
        });

        const res = await t.fetch("/async");
        expect(res.status).toBe(200);

        const middlewareAsyncStarts = listener.events.filter(
          (e) => e.asyncStart?.data.type === "middleware",
        );
        const middlewareAsyncEnds = listener.events.filter(
          (e) => e.asyncEnd?.data.type === "middleware",
        );

        expect(middlewareAsyncStarts.length).toBeGreaterThan(0);
        expect(middlewareAsyncEnds.length).toBeGreaterThan(0);
      } finally {
        listener.cleanup();
      }
    });

    it("traceMiddleware: false disables middleware tracing", async () => {
      const listener = createTracingListener();

      // Create a custom app with traceMiddleware disabled
      const app = new H3({
        plugins: [tracingPlugin({ traceMiddleware: false })],
      });

      try {
        app.use((event) => {
          event.context.middleware1 = true;
        });

        app.use((event) => {
          event.context.middleware2 = true;
        });

        app.get("/test", () => "response");

        const response = await app.request("/test");
        expect(response.status).toBe(200);

        // Wait for tracing events to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        const middlewareEvents = listener.events.filter(
          (e) => e.asyncStart?.data.type === "middleware",
        );
        const routeEvents = listener.events.filter((e) => e.asyncStart?.data.type === "route");

        // Middleware should NOT be traced
        expect(middlewareEvents.length).toBe(0);
        // Routes should still be traced
        expect(routeEvents.length).toBeGreaterThan(0);
      } finally {
        listener.cleanup();
      }
    });

    it("traceRoutes: false disables route tracing", async () => {
      const listener = createTracingListener();

      // Create a custom app with traceRoutes disabled
      const app = new H3({
        plugins: [tracingPlugin({ traceRoutes: false })],
      });

      try {
        app.use((event) => {
          event.context.middleware1 = true;
        });

        app.use((event) => {
          event.context.middleware2 = true;
        });

        app.get("/test", () => "response");

        const response = await app.request("/test");
        expect(response.status).toBe(200);

        // Wait for tracing events to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        const middlewareEvents = listener.events.filter(
          (e) => e.asyncStart?.data.type === "middleware",
        );
        const routeEvents = listener.events.filter((e) => e.asyncStart?.data.type === "route");

        // Middleware should still be traced
        expect(middlewareEvents.length).toBeGreaterThan(0);
        // Routes should NOT be traced
        expect(routeEvents.length).toBe(0);
      } finally {
        listener.cleanup();
      }
    });

    it("both options false disables all tracing", async () => {
      const listener = createTracingListener();

      // Create a custom app with both tracing options disabled
      const app = new H3({
        plugins: [tracingPlugin({ traceMiddleware: false, traceRoutes: false })],
      });

      try {
        app.use((event) => {
          event.context.middleware1 = true;
        });

        app.use((event) => {
          event.context.middleware2 = true;
        });

        app.get("/test", () => "response");

        const response = await app.request("/test");
        expect(response.status).toBe(200);

        // Wait for tracing events to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        const middlewareEvents = listener.events.filter(
          (e) => e.asyncStart?.data.type === "middleware",
        );
        const routeEvents = listener.events.filter((e) => e.asyncStart?.data.type === "route");

        // No tracing events should be emitted
        expect(middlewareEvents.length).toBe(0);
        expect(routeEvents.length).toBe(0);
      } finally {
        listener.cleanup();
      }
    });

    it("traces routes from mounted nested app", async () => {
      const listener = createTracingListener();

      try {
        const nestedApp = new H3({
          plugins: [tracingPlugin()],
        });
        nestedApp.get("/nested", () => "nested response");

        t.app.mount("/api", nestedApp);

        const response = await t.fetch("/api/nested");
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("nested response");

        // Wait for tracing events to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        const routeEvents = listener.events.filter((e) => e.asyncStart?.data.type === "route");

        // Should have traced the nested app route
        expect(routeEvents.length).toBeGreaterThan(0);
        const nestedRouteEvent = routeEvents.find(
          (e) => e.asyncStart?.data.event.url.pathname === "/api/nested",
        );
        expect(nestedRouteEvent).toBeDefined();
      } finally {
        listener.cleanup();
      }
    });

    it("traces middleware from mounted nested app", async () => {
      const listener = createTracingListener();

      try {
        const nestedApp = new H3({
          plugins: [tracingPlugin()],
        });
        nestedApp.use((event) => {
          event.context.nestedMiddleware = true;
        });
        nestedApp.get("/nested", (event) => ({
          nestedMiddleware: event.context.nestedMiddleware,
        }));

        t.app.mount("/api", nestedApp);

        const response = await t.fetch("/api/nested");
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.nestedMiddleware).toBe(true);

        // Wait for tracing events to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        const middlewareEvents = listener.events.filter(
          (e) => e.asyncStart?.data.type === "middleware",
        );

        // Should have traced the nested app middleware
        expect(middlewareEvents.length).toBeGreaterThan(0);
      } finally {
        listener.cleanup();
      }
    });

    it("traces both parent and nested app routes and middleware", async () => {
      const listener = createTracingListener();

      try {
        // Parent app route
        t.app.get("/parent", () => "parent response");

        // Nested app with route and middleware
        const nestedApp = new H3();
        nestedApp.use((event) => {
          event.context.nested = true;
        });
        nestedApp.get("/nested", () => "nested response");

        t.app.mount("/api", nestedApp);

        // Make requests to both
        const parentResponse = await t.fetch("/parent");
        expect(parentResponse.status).toBe(200);

        const nestedResponse = await t.fetch("/api/nested");
        expect(nestedResponse.status).toBe(200);

        // Wait for tracing events to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        const routeEvents = listener.events.filter((e) => e.asyncStart?.data.type === "route");
        const middlewareEvents = listener.events.filter(
          (e) => e.asyncStart?.data.type === "middleware",
        );

        // Should have traced both parent and nested routes
        expect(routeEvents.length).toBeGreaterThanOrEqual(2);

        // Should have traced nested middleware
        expect(middlewareEvents.length).toBeGreaterThan(0);

        // Verify parent route was traced
        const parentRouteEvent = routeEvents.find(
          (e) => e.asyncStart?.data.event.url.pathname === "/parent",
        );
        expect(parentRouteEvent).toBeDefined();

        // Verify nested route was traced
        const nestedRouteEvent = routeEvents.find(
          (e) => e.asyncStart?.data.event.url.pathname === "/api/nested",
        );
        expect(nestedRouteEvent).toBeDefined();
      } finally {
        listener.cleanup();
      }
    });

    it("traces deeply nested mounted apps", async () => {
      const listener = createTracingListener();

      try {
        // Create a deeply nested app structure
        const deepApp = new H3();
        deepApp.use((event) => {
          event.context.deep = true;
        });
        deepApp.get("/deep", () => "deep response");

        const midApp = new H3();
        midApp.use((event) => {
          event.context.mid = true;
        });
        midApp.mount("/v1", deepApp);

        t.app.mount("/api", midApp);

        const response = await t.fetch("/api/v1/deep");
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("deep response");

        // Wait for tracing events to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        const routeEvents = listener.events.filter((e) => e.asyncStart?.data.type === "route");
        const middlewareEvents = listener.events.filter(
          (e) => e.asyncStart?.data.type === "middleware",
        );

        // Should have traced the deep route
        expect(routeEvents.length).toBeGreaterThan(0);
        const deepRouteEvent = routeEvents.find(
          (e) => e.asyncStart?.data.event.url.pathname === "/api/v1/deep",
        );
        expect(deepRouteEvent).toBeDefined();

        // Should have traced middleware from both mid and deep apps
        expect(middlewareEvents.length).toBeGreaterThanOrEqual(2);
      } finally {
        listener.cleanup();
      }
    });

    it("traces mounted fetch handler function", async () => {
      const listener = createTracingListener();

      try {
        const fetchHandler = (req: Request) => {
          const url = new URL(req.url);
          return new Response(`Fetch handler: ${url.pathname}`);
        };

        t.app.mount("/fetch", fetchHandler);

        const response = await t.fetch("/fetch/test");
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("Fetch handler: /test");

        // Wait for tracing events to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        const routeEvents = listener.events.filter((e) => e.asyncStart?.data.type === "route");

        // Should have traced the mounted fetch handler route
        expect(routeEvents.length).toBeGreaterThan(0);
        const fetchRouteEvent = routeEvents.find(
          (e) => e.asyncStart?.data.event.url.pathname === "/fetch/test",
        );
        expect(fetchRouteEvent).toBeDefined();
      } finally {
        listener.cleanup();
      }
    });

    it("traces mounted fetchable object with fetch method", async () => {
      const listener = createTracingListener();

      try {
        const fetchableObject = {
          fetch: (req: Request) => {
            const url = new URL(req.url);
            return new Response(`Fetchable object: ${url.pathname}`);
          },
        };

        t.app.mount("/fetchable", fetchableObject);

        const response = await t.fetch("/fetchable/path");
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("Fetchable object: /path");

        // Wait for tracing events to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        const routeEvents = listener.events.filter((e) => e.asyncStart?.data.type === "route");

        // Should have traced the mounted fetchable object route
        expect(routeEvents.length).toBeGreaterThan(0);
        const fetchableRouteEvent = routeEvents.find(
          (e) => e.asyncStart?.data.event.url.pathname === "/fetchable/path",
        );
        expect(fetchableRouteEvent).toBeDefined();
      } finally {
        listener.cleanup();
      }
    });

    it("traces async fetch handler", async () => {
      const listener = createTracingListener();

      try {
        const asyncFetchHandler = async (req: Request) => {
          await Promise.resolve();
          const url = new URL(req.url);
          return new Response(`Async fetch: ${url.pathname}`);
        };

        t.app.mount("/async-fetch", asyncFetchHandler);

        const response = await t.fetch("/async-fetch/data");
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("Async fetch: /data");

        // Wait for tracing events to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        const routeEvents = listener.events.filter((e) => e.asyncStart?.data.type === "route");
        const routeEnds = listener.events.filter((e) => e.asyncEnd?.data.type === "route");

        // Should have traced the async fetch handler
        expect(routeEvents.length).toBeGreaterThan(0);
        expect(routeEnds.length).toBeGreaterThan(0);
        expect(routeEvents.length).toBe(routeEnds.length);
      } finally {
        listener.cleanup();
      }
    });

    it("traces fetch handler errors", async () => {
      const listener = createTracingListener();

      // Disable the test error handler so we can see the tracing error event
      const originalOnError = t.hooks.onError;
      t.hooks.onError.mockImplementation(() => {
        // Silence error - we're testing the tracing channel
      });

      try {
        const errorFetchHandler = (_: Request) => {
          throw new HTTPError("Fetch handler error");
        };

        t.app.mount("/error-fetch", errorFetchHandler);

        await t.fetch("/error-fetch/test");

        // Wait for tracing events to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        const errorEvents = listener.events.filter((e) => e.error);
        expect(errorEvents.length).toBeGreaterThan(0);
        expect(errorEvents[0].error?.error.message).toBe("Fetch handler error");
      } finally {
        listener.cleanup();
        t.hooks.onError = originalOnError;
      }
    });
  },
  testOpts,
);

describe("tracing channels for H3Core instances", () => {
  it("traces route handlers in H3Core", async () => {
    const listener = createTracingListener();
    const { H3Core } = await import("../src/h3.ts");
    const { tracingPlugin } = await import("../src/tracing.ts");
    const { H3Event } = await import("../src/event.ts");

    try {
      const app = new H3Core();
      const routeHandler = () => "H3Core response";

      // Manually add a route
      app["~routes"].push({
        method: "GET",
        route: "/test",
        handler: routeHandler,
      });

      // Apply tracing plugin
      tracingPlugin()(app as any);

      // Mock ~findRoute to return the matched route
      const originalFindRoute = app["~findRoute"];
      app["~findRoute"] = (event: any) => {
        if (event.url.pathname === "/test" && event.req.method === "GET") {
          return {
            data: app["~routes"][0],
            params: {},
          };
        }
        return originalFindRoute.call(app, event);
      };

      // Create an event and call handler directly
      const request = new Request("http://localhost/test", { method: "GET" });
      const event = new H3Event(request, undefined, app as any);

      await app.handler(event);

      // Wait for tracing events to be processed
      await new Promise((resolve) => setTimeout(resolve, 10));

      const routeEvents = listener.events.filter((e) => e.asyncStart?.data.type === "route");

      expect(routeEvents.length).toBeGreaterThan(0);
      const routeEvent = routeEvents[0];
      expect(routeEvent.asyncStart?.data.type).toBe("route");
      expect(routeEvent.asyncStart?.data.event).toBeDefined();
    } finally {
      listener.cleanup();
    }
  });

  it("traces middleware in H3Core", async () => {
    const listener = createTracingListener();
    const { H3Core } = await import("../src/h3.ts");
    const { tracingPlugin } = await import("../src/tracing.ts");
    const { H3Event } = await import("../src/event.ts");

    try {
      const app = new H3Core();
      const middleware1 = (event: any) => {
        event.context.mw1 = true;
      };
      const middleware2 = (event: any) => {
        event.context.mw2 = true;
      };
      const routeHandler = (event: any) => ({
        mw1: event.context.mw1,
        mw2: event.context.mw2,
      });

      // Manually add middleware
      app["~middleware"].push(middleware1, middleware2);

      // Manually add a route
      app["~routes"].push({
        method: "GET",
        route: "/test",
        handler: routeHandler,
      });

      // Apply tracing plugin
      tracingPlugin()(app as any);

      // Mock ~findRoute to return the matched route
      app["~findRoute"] = (event: any) => {
        if (event.url.pathname === "/test" && event.req.method === "GET") {
          return {
            data: app["~routes"][0],
            params: {},
          };
        }
        return undefined;
      };

      // Create an event and call handler directly
      const request = new Request("http://localhost/test", { method: "GET" });
      const event = new H3Event(request, undefined, app as any);

      await app.handler(event);

      // Wait for tracing events to be processed
      await new Promise((resolve) => setTimeout(resolve, 10));

      const middlewareEvents = listener.events.filter(
        (e) => e.asyncStart?.data.type === "middleware",
      );
      const routeEvents = listener.events.filter((e) => e.asyncStart?.data.type === "route");

      expect(middlewareEvents.length).toBe(2);
      expect(routeEvents.length).toBeGreaterThan(0);
    } finally {
      listener.cleanup();
    }
  });

  it("traces route middleware in H3Core", async () => {
    const listener = createTracingListener();
    const { H3Core } = await import("../src/h3.ts");
    const { tracingPlugin } = await import("../src/tracing.ts");
    const { H3Event } = await import("../src/event.ts");

    try {
      const app = new H3Core();
      const routeMiddleware = (event: any) => {
        event.context.routeMw = true;
      };
      const routeHandler = (event: any) => ({
        routeMw: event.context.routeMw,
      });

      // Manually add a route with middleware
      app["~routes"].push({
        method: "GET",
        route: "/test",
        handler: routeHandler,
        middleware: [routeMiddleware],
      });

      // Apply tracing plugin
      tracingPlugin()(app as any);

      // Mock ~findRoute to return the matched route
      app["~findRoute"] = (event: any) => {
        if (event.url.pathname === "/test" && event.req.method === "GET") {
          return {
            data: app["~routes"][0],
            params: {},
          };
        }
        return undefined;
      };

      // Create an event and call handler directly
      const request = new Request("http://localhost/test", { method: "GET" });
      const event = new H3Event(request, undefined, app as any);

      await app.handler(event);

      // Wait for tracing events to be processed
      await new Promise((resolve) => setTimeout(resolve, 10));

      const middlewareEvents = listener.events.filter(
        (e) => e.asyncStart?.data.type === "middleware",
      );
      const routeEvents = listener.events.filter((e) => e.asyncStart?.data.type === "route");

      expect(middlewareEvents.length).toBe(1);
      expect(routeEvents.length).toBeGreaterThan(0);
    } finally {
      listener.cleanup();
    }
  });

  it("traces async handlers in H3Core", async () => {
    const listener = createTracingListener();
    const { H3Core } = await import("../src/h3.ts");
    const { tracingPlugin } = await import("../src/tracing.ts");
    const { H3Event } = await import("../src/event.ts");

    try {
      const app = new H3Core();
      const asyncHandler = async () => {
        await Promise.resolve();
        return "async H3Core response";
      };

      // Manually add a route
      app["~routes"].push({
        method: "GET",
        route: "/async",
        handler: asyncHandler,
      });

      // Apply tracing plugin
      tracingPlugin()(app as any);

      // Mock ~findRoute to return the matched route
      app["~findRoute"] = (event: any) => {
        if (event.url.pathname === "/async" && event.req.method === "GET") {
          return {
            data: app["~routes"][0],
            params: {},
          };
        }
        return undefined;
      };

      // Create an event and call handler directly
      const request = new Request("http://localhost/async", { method: "GET" });
      const event = new H3Event(request, undefined, app as any);

      await app.handler(event);

      // Wait for tracing events to be processed
      await new Promise((resolve) => setTimeout(resolve, 10));

      const routeStarts = listener.events.filter((e) => e.asyncStart?.data.type === "route");
      const routeEnds = listener.events.filter((e) => e.asyncEnd?.data.type === "route");

      expect(routeStarts.length).toBeGreaterThan(0);
      expect(routeEnds.length).toBeGreaterThan(0);
      expect(routeStarts.length).toBe(routeEnds.length);
    } finally {
      listener.cleanup();
    }
  });

  it("traces errors in H3Core handlers", async () => {
    const listener = createTracingListener();
    const { H3Core } = await import("../src/h3.ts");
    const { tracingPlugin } = await import("../src/tracing.ts");
    const { H3Event } = await import("../src/event.ts");

    try {
      const app = new H3Core({
        onError: () => {
          // Silence error - we're testing the tracing channel
        },
      });
      const errorHandler = () => {
        throw new Error("H3Core handler error");
      };

      // Manually add a route
      app["~routes"].push({
        method: "GET",
        route: "/error",
        handler: errorHandler,
      });

      // Apply tracing plugin
      tracingPlugin()(app as any);

      // Mock ~findRoute to return the matched route
      app["~findRoute"] = (event: any) => {
        if (event.url.pathname === "/error" && event.req.method === "GET") {
          return {
            data: app["~routes"][0],
            params: {},
          };
        }
        return undefined;
      };

      // Create an event and call handler directly
      const request = new Request("http://localhost/error", { method: "GET" });
      const event = new H3Event(request, undefined, app as any);

      try {
        await app.handler(event);
      } catch {
        // Expected error
      }

      // Wait for tracing events to be processed
      await new Promise((resolve) => setTimeout(resolve, 10));

      const errorEvents = listener.events.filter((e) => e.error);
      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0].error?.error.message).toBe("H3Core handler error");
    } finally {
      listener.cleanup();
    }
  });

  it("respects traceMiddleware: false for H3Core", async () => {
    const listener = createTracingListener();
    const { H3Core } = await import("../src/h3.ts");
    const { tracingPlugin } = await import("../src/tracing.ts");
    const { H3Event } = await import("../src/event.ts");

    try {
      const app = new H3Core();
      const middleware = (event: any) => {
        event.context.mw = true;
      };
      const routeHandler = () => "response";

      // Manually add middleware
      app["~middleware"].push(middleware);

      // Manually add a route
      app["~routes"].push({
        method: "GET",
        route: "/test",
        handler: routeHandler,
      });

      // Apply tracing plugin with traceMiddleware disabled
      tracingPlugin({ traceMiddleware: false })(app as any);

      // Mock ~findRoute to return the matched route
      app["~findRoute"] = (event: any) => {
        if (event.url.pathname === "/test" && event.req.method === "GET") {
          return {
            data: app["~routes"][0],
            params: {},
          };
        }
        return undefined;
      };

      // Create an event and call handler directly
      const request = new Request("http://localhost/test", { method: "GET" });
      const event = new H3Event(request, undefined, app as any);

      await app.handler(event);

      // Wait for tracing events to be processed
      await new Promise((resolve) => setTimeout(resolve, 10));

      const middlewareEvents = listener.events.filter(
        (e) => e.asyncStart?.data.type === "middleware",
      );
      const routeEvents = listener.events.filter((e) => e.asyncStart?.data.type === "route");

      // Middleware should NOT be traced
      expect(middlewareEvents.length).toBe(0);
      // Routes should still be traced
      expect(routeEvents.length).toBeGreaterThan(0);
    } finally {
      listener.cleanup();
    }
  });

  it("respects traceRoutes: false for H3Core", async () => {
    const listener = createTracingListener();
    const { H3Core } = await import("../src/h3.ts");
    const { tracingPlugin } = await import("../src/tracing.ts");
    const { H3Event } = await import("../src/event.ts");

    try {
      const app = new H3Core();
      const middleware = (event: any) => {
        event.context.mw = true;
      };
      const routeHandler = () => "response";

      // Manually add middleware
      app["~middleware"].push(middleware);

      // Manually add a route
      app["~routes"].push({
        method: "GET",
        route: "/test",
        handler: routeHandler,
      });

      // Apply tracing plugin with traceRoutes disabled
      tracingPlugin({ traceRoutes: false })(app as any);

      // Mock ~findRoute to return the matched route
      app["~findRoute"] = (event: any) => {
        if (event.url.pathname === "/test" && event.req.method === "GET") {
          return {
            data: app["~routes"][0],
            params: {},
          };
        }
        return undefined;
      };

      // Create an event and call handler directly
      const request = new Request("http://localhost/test", { method: "GET" });
      const event = new H3Event(request, undefined, app as any);

      await app.handler(event);

      // Wait for tracing events to be processed
      await new Promise((resolve) => setTimeout(resolve, 10));

      const middlewareEvents = listener.events.filter(
        (e) => e.asyncStart?.data.type === "middleware",
      );
      const routeEvents = listener.events.filter((e) => e.asyncStart?.data.type === "route");

      // Middleware should still be traced
      expect(middlewareEvents.length).toBeGreaterThan(0);
      // Routes should NOT be traced
      expect(routeEvents.length).toBe(0);
    } finally {
      listener.cleanup();
    }
  });
});
