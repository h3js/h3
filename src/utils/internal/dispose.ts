import { FastResponse } from "srvx";

import type { H3Event } from "../../event.ts";

export const kEventDispose: unique symbol = /* @__PURE__ */ Symbol.for("h3.internal.event.dispose");

export type DisposeCallback = (reason?: unknown) => unknown;

/**
 * The value stored on the event at `kEventDispose`. Installed by the first
 * `onDispose` registration, so core (`toResponse`) only pays a symbol check
 * and an `observe` call — all machinery stays in this module and tree-shakes
 * out of apps that never import `onDispose`.
 */
export interface DisposeState {
  callbacks: DisposeCallback[];
  /** Start observing the prepared response for end-of-event (called by `toResponse`). */
  observe: (response: Response) => Response;
  /** An observer is already attached to a response. */
  observing?: boolean;
  disposed?: boolean;
  reason?: unknown;
}

/**
 * Register a callback that runs once the event is fully over: the response
 * body finished streaming, the client disconnected, or the body errored.
 *
 * The callback receives `undefined` on normal completion, or the
 * cancel/abort reason otherwise. Callbacks run in registration order after
 * the global `onResponse` hook; sync throws and async rejections are
 * absorbed (reported via `console.error` unless the app is configured with
 * `silent`), and pending async callbacks are passed to `waitUntil`.
 *
 * Registering after disposal invokes the callback immediately. Registration
 * is only guaranteed to observe the end of the event when made during
 * request handling (handler, middleware, or `onResponse`).
 *
 * Note: this signals *"h3 is done with this event"*, not *"the client
 * received the response"* — for non-streaming bodies on non-Node runtimes
 * it fires when the response is handed to the runtime.
 */
export function onDispose(event: H3Event, cb: DisposeCallback): void {
  let state = (event as any)[kEventDispose] as DisposeState | undefined;
  if (!state) {
    const _state: DisposeState = {
      callbacks: [],
      observe: (response) => observeResponse(response, event, _state),
    };
    state = (event as any)[kEventDispose] = _state;
  }
  if (state.disposed) {
    invokeDisposeCallbacks(event, [cb], state.reason);
  } else {
    state.callbacks.push(cb);
  }
}

/**
 * Start observing the prepared response for end-of-event. Called once from
 * `toResponse` (via `state.observe`) after global `onResponse`.
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
function observeResponse(response: Response, event: H3Event, state: DisposeState): Response {
  if (state.observing || state.disposed) {
    return response;
  }
  state.observing = true;

  const nodeRes = event.runtime?.node?.res;
  if (nodeRes) {
    // The client may have disconnected while the handler was still running —
    // "close" was already emitted and a listener would never fire.
    if (nodeRes.closed || nodeRes.destroyed) {
      fireDispose(event, state, nodeRes.errored ?? abortError());
      return response;
    }
    nodeRes.once("close", () => {
      fireDispose(
        event,
        state,
        nodeRes.errored ?? (nodeRes.writableFinished ? undefined : abortError()),
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
    // An argless `reader.cancel()` rejects with `undefined` — normalize it so
    // an abort is never mistaken for normal completion (`undefined` reason).
    (reason) => fireDispose(event, state, reason === undefined ? abortError() : reason),
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

function abortError(): DOMException {
  return new DOMException("Connection closed prematurely.", "AbortError");
}

function reportDisposeError(event: H3Event, error: unknown): void {
  if (!event.app?.config.silent) {
    console.error("[h3] onDispose:", error);
  }
}
