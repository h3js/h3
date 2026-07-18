import type { H3Event } from "../../event.ts";
import type { EventStreamMessage, EventStreamOptions } from "../event-stream.ts";

const _noop = () => {};

/** Run a user callback, swallowing sync throws and async rejections alike. */
function _invoke(cb: () => any): void {
  try {
    Promise.resolve(cb()).catch(_noop);
  } catch {
    // Ignore
  }
}

/**
 * A helper class for [server sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format)
 */
export class EventStream {
  private readonly _event: H3Event;
  private readonly _transformStream = new TransformStream();
  private readonly _writer: WritableStreamDefaultWriter;
  private readonly _encoder: TextEncoder = new TextEncoder();

  private _writerIsClosed = false;
  private _paused = false;
  private _unsentData: undefined | string;
  private _disposed = false;
  private _handled = false;
  private readonly _closeCallbacks: Array<() => any> = [];
  private _closeNotified = false;
  private _detachAutoclose: () => void = _noop;

  private get _isClosed(): boolean {
    return this._writerIsClosed || this._disposed;
  }

  constructor(event: H3Event, opts: EventStreamOptions = {}) {
    this._event = event;
    this._writer = this._transformStream.writable.getWriter();
    // `closed` settles on both paths: `close()` resolves it, while a consumer
    // cancelling the readable side (client disconnect) rejects it. Both mean
    // the stream is over, so `finally` is what listeners must hang off.
    this._writer.closed.catch(_noop).finally(() => {
      this._writerIsClosed = true;
      this._notifyClosed();
    });
    if (opts.autoclose !== false) {
      this._watchDisconnect();
    }
  }

  /**
   * Close the stream once the client goes away.
   *
   * The Node adapter surfaces a disconnect as a `"close"` event on the raw
   * response, while every other runtime (Bun, Deno, workerd, generic web)
   * surfaces it as the request's `AbortSignal`. Both are wired, since
   * `close()` is idempotent and only the applicable one fires.
   */
  private _watchDisconnect(): void {
    const onDisconnect = () => {
      this.close();
    };
    const nodeRes = this._event.runtime?.node?.res;
    const signal = this._event.req.signal;
    if (signal?.aborted) {
      onDisconnect();
      return;
    }
    nodeRes?.once("close", onDisconnect);
    signal?.addEventListener("abort", onDisconnect, { once: true });
    this._detachAutoclose = () => {
      nodeRes?.off("close", onDisconnect);
      signal?.removeEventListener("abort", onDisconnect);
    };
  }

  /**
   * Run `onClosed` callbacks exactly once and drop the disconnect listeners.
   */
  private _notifyClosed(): void {
    if (this._closeNotified) {
      return;
    }
    this._closeNotified = true;
    this._detachAutoclose();
    this._detachAutoclose = _noop;
    for (const cb of this._closeCallbacks.splice(0)) {
      _invoke(cb);
    }
  }

  /**
   * Publish new event(s) for the client
   */
  async push(message: string): Promise<void>;
  async push(message: string[]): Promise<void>;
  async push(message: EventStreamMessage): Promise<void>;
  async push(message: EventStreamMessage[]): Promise<void>;
  async push(message: EventStreamMessage | EventStreamMessage[] | string | string[]) {
    if (typeof message === "string") {
      await this._sendEvent({ data: message });
      return;
    }
    if (Array.isArray(message)) {
      if (message.length === 0) {
        return;
      }
      if (typeof message[0] === "string") {
        const msgs: EventStreamMessage[] = [];
        for (const item of message as string[]) {
          msgs.push({ data: item });
        }
        await this._sendEvents(msgs);
        return;
      }
      await this._sendEvents(message as EventStreamMessage[]);
      return;
    }
    await this._sendEvent(message);
  }

  async pushComment(comment: string): Promise<void> {
    if (this._isClosed) {
      return;
    }
    if (this._paused && !this._unsentData) {
      this._unsentData = formatEventStreamComment(comment);
      return;
    }
    if (this._paused) {
      this._unsentData += formatEventStreamComment(comment);
      return;
    }
    await this._writer.write(this._encoder.encode(formatEventStreamComment(comment))).catch(() => {
      this._writerIsClosed = true;
    });
  }

  private async _sendEvent(message: EventStreamMessage) {
    if (this._isClosed) {
      return;
    }
    if (this._paused && !this._unsentData) {
      this._unsentData = formatEventStreamMessage(message);
      return;
    }
    if (this._paused) {
      this._unsentData += formatEventStreamMessage(message);
      return;
    }
    await this._writer.write(this._encoder.encode(formatEventStreamMessage(message))).catch(() => {
      this._writerIsClosed = true;
    });
  }

  private async _sendEvents(messages: EventStreamMessage[]) {
    if (this._isClosed) {
      return;
    }
    const payload = formatEventStreamMessages(messages);
    if (this._paused && !this._unsentData) {
      this._unsentData = payload;
      return;
    }
    if (this._paused) {
      this._unsentData += payload;
      return;
    }

    await this._writer.write(this._encoder.encode(payload)).catch(() => {
      this._writerIsClosed = true;
    });
  }

  pause(): void {
    this._paused = true;
  }

  get isPaused(): boolean {
    return this._paused;
  }

  async resume(): Promise<void> {
    this._paused = false;
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this._isClosed) {
      return;
    }
    if (this._unsentData?.length) {
      await this._writer.write(this._encoder.encode(this._unsentData)).catch(() => {
        this._writerIsClosed = true;
      });
      this._unsentData = undefined;
    }
  }

  /**
   * Close the stream and the connection if the stream is being sent to the client
   */
  async close(): Promise<void> {
    if (this._disposed) {
      return;
    }
    if (!this._isClosed) {
      try {
        await this._writer.close();
      } catch {
        // Ignore
      }
    }
    this._disposed = true;
    this._notifyClosed();
  }

  /**
   * Triggers callback when the stream is closed, whether by calling `close()`
   * or by the client disconnecting. Guaranteed to run at most once.
   */
  onClosed(cb: () => any): void {
    if (this._closeNotified) {
      // Preserve async delivery for callbacks registered after close.
      queueMicrotask(() => _invoke(cb));
      return;
    }
    this._closeCallbacks.push(cb);
  }

  async send(): Promise<BodyInit> {
    setEventStreamHeaders(this._event);
    this._event.res.status = 200;
    this._handled = true;
    return this._transformStream.readable;
  }
}

export function isEventStream(input: unknown): input is EventStream {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  return input instanceof EventStream;
}

export function formatEventStreamComment(comment: string): string {
  return (
    comment
      .split(/\r\n|\r|\n/)
      .map((l) => `: ${l}\n`)
      .join("") + "\n"
  );
}

export function formatEventStreamMessage(message: EventStreamMessage): string {
  let result = "";
  if (message.id) {
    result += `id: ${_sanitizeSingleLine(message.id)}\n`;
  }
  if (message.event) {
    result += `event: ${_sanitizeSingleLine(message.event)}\n`;
  }
  if (typeof message.retry === "number" && Number.isInteger(message.retry)) {
    result += `retry: ${message.retry}\n`;
  }
  const data = typeof message.data === "string" ? message.data : "";
  for (const line of data.split(/\r\n|\r|\n/)) {
    result += `data: ${line}\n`;
  }
  result += "\n";
  return result;
}

function _sanitizeSingleLine(value: string): string {
  return value.replace(/[\n\r]/g, "");
}

export function formatEventStreamMessages(messages: EventStreamMessage[]): string {
  let result = "";
  for (const msg of messages) {
    result += formatEventStreamMessage(msg);
  }
  return result;
}

export function setEventStreamHeaders(event: H3Event): void {
  event.res.headers.set("content-type", "text/event-stream");
  event.res.headers.set(
    "cache-control",
    "private, no-cache, no-store, no-transform, must-revalidate, max-age=0",
  );
  // prevent nginx from buffering the response
  event.res.headers.set("x-accel-buffering", "no");

  if (event.req.headers.get("connection") === "keep-alive") {
    event.res.headers.set("connection", "keep-alive");
  }
}
