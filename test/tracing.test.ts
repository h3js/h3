import { channel, tracingChannel } from "node:diagnostics_channel";
import { describeMatrix } from "./_setup.ts";
import { H3 } from "../src/h3.ts";
import {
  type H3InitPayload,
  type H3MountPayload,
  type H3THandlerTracePayload,
  tracingPlugin,
} from "../src/tracing.ts";

type TracingEvent = {
  start?: { data: H3THandlerTracePayload };
  end?: { data: H3THandlerTracePayload };
  asyncStart?: { data: H3THandlerTracePayload };
  asyncEnd?: { data: H3THandlerTracePayload; result?: any; error?: Error };
  error?: { data: H3THandlerTracePayload; error: Error };
};

function createH3WithTracing() {
  const app = new H3({
    plugins: [tracingPlugin()],
  });

  return app;
}

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

describeMatrix(
  "tracing channels",
  (t, { it, expect }) => {
    it("h3.init channel fires when app is initialized", async () => {
      const events: H3InitPayload[] = [];
      const initChannel = channel("h3.init");

      const handler = (message: unknown) => {
        events.push(message as H3InitPayload);
      };
      initChannel.subscribe(handler);

      try {
        const app = createH3WithTracing();
        expect(events).toHaveLength(1);
        expect(events[0].app).toBe(app);
      } finally {
        initChannel.unsubscribe(handler);
      }
    });

    it("h3.init listener can configure global error handler", async () => {
      const initChannel = channel("h3.init");

      const customError = (error: any) => {
        return new Response(
          JSON.stringify({ custom: true, message: error.message }),
          {
            status: error.status || 500,
            headers: { "content-type": "application/json" },
          },
        );
      };

      const handler = (message: unknown) => {
        const { app } = message as H3InitPayload;
        app.config.onError = customError;
      };
      initChannel.subscribe(handler);

      try {
        const app = createH3WithTracing();
        app.get("/error", () => {
          throw new Error("Test error");
        });

        const res = await app.request("/error");
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.custom).toBe(true);
        expect(body.message).toBe("Test error");
      } finally {
        initChannel.unsubscribe(handler);
      }
    });

    it("h3.mount channel fires when nested app is mounted", async () => {
      const events: H3MountPayload[] = [];
      const mountChannel = channel("h3.mount");

      const handler = (message: unknown) => {
        events.push(message as H3MountPayload);
      };
      mountChannel.subscribe(handler);

      try {
        const nestedApp = createH3WithTracing();
        nestedApp.get("/test", () => "nested");

        t.app.mount("/api", nestedApp);

        expect(events).toHaveLength(1);
        expect(events[0].app).toBe(t.app);
        expect(events[0].base).toBe("/api");
        expect(events[0].mountedApp).toBe(nestedApp);
      } finally {
        mountChannel.unsubscribe(handler);
      }
    });

    it("h3.mount channel fires for fetchable objects", async () => {
      const events: H3MountPayload[] = [];
      const mountChannel = channel("h3.mount");

      const handler = (message: unknown) => {
        events.push(message as H3MountPayload);
      };
      mountChannel.subscribe(handler);

      try {
        const fetchHandler = {
          fetch: () => new Response("fetchable"),
        };

        t.app.mount("/fetch", fetchHandler);

        expect(events).toHaveLength(1);
        expect(events[0].app).toBe(t.app);
        expect(events[0].base).toBe("/fetch");
        expect(events[0].mountedApp).toBe(fetchHandler);
      } finally {
        mountChannel.unsubscribe(handler);
      }
    });

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
  },
  { tracing: true },
);
