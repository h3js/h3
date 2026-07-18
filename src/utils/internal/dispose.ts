import { FastResponse } from "srvx";

import type { H3Event } from "../../event.ts";

export const kEventDispose: unique symbol = /* @__PURE__ */ Symbol.for("h3.internal.event.dispose");

export type DisposeCallback = (reason?: unknown) => unknown;

/**
 * The value stored on the event at `kEventDispose`. Installed by the first
 * `onDispose` registration, so core (`toResponse`) only pays a symbol check
 * and an `arm` call — all machinery stays in this module and tree-shakes out
 * of apps that never import `onDispose`.
 */
export interface DisposeState {
  callbacks: DisposeCallback[];
  /** Arm end-of-event observation for the prepared response (called by `toResponse`). */
  arm: (response: Response) => Response;
  armed?: boolean;
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
      arm: (response) => armDispose(response, event, _state),
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
 * Arm end-of-event observation for the prepared response. Called once from
 * `toResponse` (via `state.arm`) after global `onResponse`.
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
function armDispose(response: Response, event: H3Event, state: DisposeState): Response {
  if (state.armed || state.disposed) {
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
