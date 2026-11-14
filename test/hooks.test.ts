import { vi } from "vitest";
import { HTTPError, onDispose } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

const request = (path = "/foo") => new Request(`http://localhost${path}`);

describeMatrix("hooks", (t, { it, expect }) => {
  it("calls onRequest and onResponse", async () => {
    t.app.use(() => Promise.resolve("Hello World!"));
    await t.fetch("/foo");

    expect(t.hooks.onRequest).toHaveBeenCalledTimes(1);
    expect(t.hooks.onRequest.mock.calls[0]![0]!.path).toBe("/foo");

    expect(t.hooks.onError).toHaveBeenCalledTimes(0);

    expect(t.hooks.onResponse).toHaveBeenCalledTimes(1);

    // In Node.js, srvx garbage collects the response body after preparing it for Node.js
    if (t.target !== "node") {
      const res = t.hooks.onResponse.mock.calls[0]![0]!;
      expect(await res.text()).toBe("Hello World!");
    }
  });

  it("сalls onRequest and onResponse when an exception is thrown", async () => {
    t.app.use(() => {
      throw new HTTPError({ status: 503 });
    });
    await t.fetch("/foo");

    expect(t.hooks.onRequest).toHaveBeenCalledTimes(1);
    expect(t.hooks.onRequest.mock.calls[0]![0]!.path).toBe("/foo");

    expect(t.hooks.onError).toHaveBeenCalledTimes(1);
    expect(t.hooks.onError.mock.calls[0]![0]!.status).toBe(503);
    expect(t.hooks.onError.mock.calls[0]![1]!.path).toBe("/foo");

    expect(t.hooks.onResponse).toHaveBeenCalledTimes(1);
  });

  it("calls onRequest and onResponse when an error is thrown", async () => {
    t.app.use(() => {
      throw new HTTPError({ status: 404 });
    });
    await t.fetch("/foo");

    expect(t.hooks.onRequest).toHaveBeenCalledTimes(1);
    expect(t.hooks.onRequest.mock.calls[0]![0]!.path).toBe("/foo");

    expect(t.hooks.onError).toHaveBeenCalledTimes(1);
    expect(t.hooks.onError.mock.calls[0]![0]!.status).toBe(404);
    expect(t.hooks.onError.mock.calls[0]![1]!.path).toBe("/foo");

    expect(t.hooks.onResponse).toHaveBeenCalledTimes(1);
  });

  it("absorbs a throwing onResponse hook without failing the request", async () => {
    t.app.use(() => "Hello World!");
    const hookError = new Error("onResponse boom");
    t.hooks.onResponse.mockImplementationOnce(() => {
      throw hookError;
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await t.fetch("/foo");

    // Request still succeeds with the already-built response
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Hello World!");

    // Error is absorbed and logged, not routed back into onError
    expect(t.hooks.onError).toHaveBeenCalledTimes(0);
    expect(consoleError).toHaveBeenCalledWith(hookError);
    consoleError.mockRestore();
  });

  it("calls onRequest and onResponse when an unhandled error occurs", async () => {
    t.app.use((event) => {
      // @ts-expect-error
      return event.unknown.property;
    });

    vi.spyOn(console, "error").mockImplementation(() => {});
    await t.fetch("/foo");

    const errors = t.errors;
    t.errors = [];

    expect(errors.length).toBe(1);
    expect(errors[0].status).toBe(500);

    expect(t.hooks.onRequest).toHaveBeenCalledTimes(1);
    expect(t.hooks.onRequest.mock.calls[0][0].path).toBe("/foo");

    expect(t.hooks.onError).toHaveBeenCalledTimes(1);
    expect(t.hooks.onError.mock.calls[0]![0]!.status).toBe(500);
    expect(t.hooks.onError.mock.calls[0]![0]!.cause).toBeInstanceOf(TypeError);
    expect(t.hooks.onError.mock.calls[0]![1]!.path).toBe("/foo");

    expect(t.hooks.onResponse).toHaveBeenCalledTimes(1);
  });

  it("calls onRequest, onError and onResponse when a circular value is returned", async () => {
    t.app.use(() => {
      const circular: any = {};
      circular.self = circular;
      return circular;
    });

    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await t.fetch("/foo");

    const errors = t.errors;
    t.errors = [];

    // The synchronous `JSON.stringify` throw is routed through the error pipeline
    // instead of escaping `fetch()` as a raw exception/rejection.
    expect(res.status).toBe(500);

    expect(errors.length).toBe(1);
    expect(errors[0].status).toBe(500);
    expect(errors[0].cause).toBeInstanceOf(TypeError);

    expect(t.hooks.onRequest).toHaveBeenCalledTimes(1);
    expect(t.hooks.onError).toHaveBeenCalledTimes(1);
    expect(t.hooks.onError.mock.calls[0]![0]!.cause).toBeInstanceOf(TypeError);
    expect(t.hooks.onResponse).toHaveBeenCalledTimes(1);
  });

  it("returns a Response synchronously when the handler and onResponse are sync", async () => {
    let ran = false;
    t.hooks.onResponse.mockImplementation(() => {
      ran = true;
    });
    t.app.use(() => "Hello World!");

    const res = t.app.fetch(request());

    expect(res).toBeInstanceOf(Response);
    expect(res instanceof Promise).toBe(false);
    if (res instanceof Promise) throw new TypeError("expected Response");
    expect(ran).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Hello World!");
    expect(t.hooks.onError).not.toHaveBeenCalled();
  });

  it("absorbs a sync onResponse throw and still returns a Response", async () => {
    const hookError = new Error("onResponse boom");
    let disposed = false;
    t.hooks.onResponse.mockImplementationOnce(() => {
      throw hookError;
    });
    t.app.use((event) => {
      onDispose(event, () => {
        disposed = true;
      });
      return "Hello World!";
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = t.app.fetch(request());

      expect(res).toBeInstanceOf(Response);
      expect(res instanceof Promise).toBe(false);
      if (res instanceof Promise) throw new TypeError("expected Response");
      expect(disposed).toBe(true);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Hello World!");
      expect(t.hooks.onError).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(hookError);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not log a sync onResponse throw when silent", async () => {
    const hookError = new Error("onResponse boom");
    t.app.config.silent = true;
    t.hooks.onResponse.mockImplementationOnce(() => {
      throw hookError;
    });
    t.app.use(() => "Hello World!");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = t.app.fetch(request());

      expect(res instanceof Promise).toBe(false);
      if (res instanceof Promise) throw new TypeError("expected Response");
      expect(res.status).toBe(200);
      expect(t.hooks.onError).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("resolves only after an async onResponse settles, then observes dispose", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.hooks.onResponse.mockImplementation(() => {
      order.push("onResponse:start");
      return gate.then(() => {
        order.push("onResponse:end");
      });
    });
    t.app.use((event) => {
      onDispose(event, () => {
        order.push("dispose");
      });
      return "ok";
    });

    const pending = t.app.fetch(request());
    expect(pending).toBeInstanceOf(Promise);
    if (!(pending instanceof Promise)) throw new TypeError("expected Promise");
    expect(order).toEqual(["onResponse:start"]);

    let resolved = false;
    const done = pending.then((res) => {
      resolved = true;
      order.push("resolved");
      return res;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    release();
    const res = await done;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(order).toEqual(["onResponse:start", "onResponse:end", "dispose", "resolved"]);
  });

  it("absorbs a rejected onResponse and still resolves the built response", async () => {
    const hookError = new Error("onResponse reject");
    t.hooks.onResponse.mockImplementationOnce(() => Promise.reject(hookError));
    t.app.use(() => "Hello World!");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const pending = t.app.fetch(request());
      expect(pending).toBeInstanceOf(Promise);
      const res = await pending;
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Hello World!");
      expect(t.hooks.onError).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(hookError);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("absorbs a throwing then getter from onResponse and still returns a Response", async () => {
    const hookError = new Error("then-getter");
    let disposed = false;
    t.hooks.onResponse.mockImplementationOnce(
      () =>
        ({
          // eslint-disable-next-line unicorn/no-thenable
          get then() {
            throw hookError;
          },
        }) as unknown as Promise<void>,
    );
    t.app.use((event) => {
      onDispose(event, () => {
        disposed = true;
      });
      return "ok";
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = t.app.fetch(request());

      expect(res).toBeInstanceOf(Response);
      expect(res instanceof Promise).toBe(false);
      if (res instanceof Promise) throw new TypeError("expected Response");
      expect(disposed).toBe(true);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
      expect(t.hooks.onError).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(hookError);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not log a throwing then getter from onResponse when silent", async () => {
    const hookError = new Error("then-getter");
    let disposed = false;
    t.app.config.silent = true;
    t.hooks.onResponse.mockImplementationOnce(
      () =>
        ({
          // eslint-disable-next-line unicorn/no-thenable
          get then() {
            throw hookError;
          },
        }) as unknown as Promise<void>,
    );
    t.app.use((event) => {
      onDispose(event, () => {
        disposed = true;
      });
      return "ok";
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = t.app.fetch(request());

      expect(res).toBeInstanceOf(Response);
      expect(res instanceof Promise).toBe(false);
      if (res instanceof Promise) throw new TypeError("expected Response");
      expect(disposed).toBe(true);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
      expect(t.hooks.onError).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("absorbs a throwing then method from onResponse and still resolves the built response", async () => {
    const hookError = new Error("then-method");
    let disposed = false;
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => {
      unhandled.push(error);
    };
    process.on("unhandledRejection", onUnhandled);
    t.hooks.onResponse.mockImplementationOnce(
      () =>
        ({
          // eslint-disable-next-line unicorn/no-thenable
          then() {
            throw hookError;
          },
        }) as unknown as Promise<void>,
    );
    t.app.use((event) => {
      onDispose(event, () => {
        disposed = true;
      });
      return "ok";
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const pending = t.app.fetch(request());
      expect(pending).toBeInstanceOf(Promise);
      if (!(pending instanceof Promise)) throw new TypeError("expected Promise");
      expect(disposed).toBe(false);

      const res = await pending;
      expect(disposed).toBe(true);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
      expect(t.hooks.onError).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(hookError);
      await Promise.resolve();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      consoleError.mockRestore();
    }
  });

  it("does not log a rejected onResponse when silent", async () => {
    const hookError = new Error("onResponse reject");
    t.app.config.silent = true;
    t.hooks.onResponse.mockImplementationOnce(() => Promise.reject(hookError));
    t.app.use(() => "Hello World!");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await t.app.fetch(request());
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Hello World!");
      expect(t.hooks.onError).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
