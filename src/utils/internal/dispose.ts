import { FastResponse } from "srvx";

import type { H3Event } from "../../event.ts";

export const kEventDispose: unique symbol = /* @__PURE__ */ Symbol.for("h3.internal.event.dispose");

export type DisposeCallback = (reason?: unknown) => unknown;

interface DisposeState {
  callbacks: DisposeCallback[];
  armed?: boolean;
  disposed?: boolean;
  reason?: unknown;
}

/**
 * Queue a dispose callback on the event (used by `event.onDispose`).
 *
 * Registering after disposal invokes the callback immediately with the
 * recorded reason.
 */
export function registerDispose(event: H3Event, cb: DisposeCallback): void {
  const state: DisposeState = ((event as any)[kEventDispose] ??= { callbacks: [] });
  if (state.disposed) {
    invokeDisposeCallbacks(event, [cb], state.reason);
  } else {
    state.callbacks.push(cb);
  }
}

/**
 * Arm end-of-event observation for the prepared response. Called once from
 * `toResponse` after global `onResponse`, only when a callback is registered.
 *
 * - Node: `res` `"close"` fires after the last byte lands (or on premature
 *   disconnect) — accurate for streaming and non-streaming bodies alike, so
 *   the body is never wrapped.
 * - Other runtimes: a streaming body is piped through an identity
 *   `TransformStream`; the `pipeTo` promise settles on normal end, consumer
 *   cancellation, and source error alike. Bodyless responses dispose
 *   immediately — once the `Response` is handed to the runtime, delivery is
 *   not observable on web.
 */
export function armDispose(response: Response, event: H3Event): Response {
  const state = (event as any)[kEventDispose] as DisposeState | undefined;
  if (!state || state.armed || state.disposed) {
    return response;
  }
  state.armed = true;

  const nodeRes = event.runtime?.node?.res;
  if (nodeRes) {
    nodeRes.once("close", () => {
      fireDispose(
        event,
        state,
        nodeRes.errored ??
          (nodeRes.writableFinished
            ? undefined
            : new DOMException("Connection closed prematurely.", "AbortError")),
      );
    });
    return response;
  }

  const body = response.body;
  if (!body) {
    fireDispose(event, state, undefined);
    return response;
  }

  const { readable, writable } = new TransformStream();
  body.pipeTo(writable).then(
    () => fireDispose(event, state, undefined),
    (reason) => fireDispose(event, state, reason),
  );
  return new FastResponse(readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function fireDispose(event: H3Event, state: DisposeState, reason: unknown): void {
  if (state.disposed) {
    return;
  }
  state.disposed = true;
  state.reason = reason;
  const callbacks = state.callbacks;
  state.callbacks = [];
  invokeDisposeCallbacks(event, callbacks, reason);
}

function invokeDisposeCallbacks(
  event: H3Event,
  callbacks: DisposeCallback[],
  reason: unknown,
): void {
  const pending: Promise<unknown>[] = [];
  for (const cb of callbacks) {
    try {
      const res = cb(reason) as Promise<unknown> | undefined;
      if (typeof res?.then === "function") {
        pending.push(Promise.resolve(res).catch((error) => reportDisposeError(event, error)));
      }
    } catch (error) {
      reportDisposeError(event, error);
    }
  }
  if (pending.length > 0) {
    // Post-response work is not guaranteed to run on serverless runtimes
    // unless handed to the platform.
    event.waitUntil(Promise.all(pending));
  }
}

function reportDisposeError(event: H3Event, error: unknown): void {
  if (!event.app?.config.silent) {
    console.error("[h3] onDispose:", error);
  }
}
