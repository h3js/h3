import { tracingChannel } from "node:diagnostics_channel";
import { describeMatrix, type TestOptions } from "./_setup.ts";
import { H3 } from "../src/h3.ts";
import { tracingPlugin, type H3THandlerTracePayload } from "../src/tracing.ts";

type TracingEvent = {
  start?: { data: H3THandlerTracePayload };
  end?: { data: H3THandlerTracePayload };
  asyncStart?: { data: H3THandlerTracePayload };
  asyncEnd?: { data: H3THandlerTracePayload; result?: any; error?: Error };
  error?: { data: H3THandlerTracePayload; error: Error };
};

function createTracingListener() {
  const events: TracingEvent[] = [];

  const tracingCh = tracingChannel("h3.request.handler");

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
          (e) =>
            e.asyncStart?.data.type === "route" ||
            e.asyncEnd?.data.type === "route",
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

    it("tracing:h3.request.handler:asyncStart/asyncEnd fire for async handlers", async () => {
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

        const routeStart = asyncStarts.find(
          (e) => e.asyncStart?.data.type === "route",
        );
        const routeEnd = asyncEnds.find(
          (e) => e.asyncEnd?.data.type === "route",
        );

        expect(routeStart).toBeDefined();
        expect(routeEnd).toBeDefined();
      } finally {
        listener.cleanup();
      }
    });

    it("tracing:h3.request.handler:error fires when handler throws", async () => {
      const listener = createTracingListener();

      // Disable the test error handler so we can see the tracing error event
      const originalOnError = t.hooks.onError;
      t.hooks.onError.mockImplementation(() => {
        // Silence error - we're testing the tracing channel
      });

      try {
        t.app.get("/error", () => {
          throw new Error("Handler error");
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
        const middlewareEvents = allStarts.filter(
          (e) => e.asyncStart?.data.type === "middleware",
        );
        const routeEvents = allStarts.filter(
          (e) => e.asyncStart?.data.type === "route",
        );

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
        const routeStarts = listener.events.filter(
          (e) => e.asyncStart?.data.type === "route",
        );
        const routeEnds = listener.events.filter(
          (e) => e.asyncEnd?.data.type === "route",
        );

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

    it("traceMiddlewares: false disables middleware tracing", async () => {
      const listener = createTracingListener();

      // Create a custom app with traceMiddlewares disabled
      const app = new H3({
        plugins: [tracingPlugin({ traceMiddlewares: false })],
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
        const routeEvents = listener.events.filter(
          (e) => e.asyncStart?.data.type === "route",
        );

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
        const routeEvents = listener.events.filter(
          (e) => e.asyncStart?.data.type === "route",
        );

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
        plugins: [
          tracingPlugin({ traceMiddlewares: false, traceRoutes: false }),
        ],
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
        const routeEvents = listener.events.filter(
          (e) => e.asyncStart?.data.type === "route",
        );

        // No tracing events should be emitted
        expect(middlewareEvents.length).toBe(0);
        expect(routeEvents.length).toBe(0);
      } finally {
        listener.cleanup();
      }
    });
  },
  testOpts,
);
