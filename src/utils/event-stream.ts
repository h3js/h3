import type { H3Event } from "../event.ts";
import { HTTPResponse } from "../response.ts";
import { onDispose } from "./internal/dispose.ts";
import {
  eventStreamHeaders,
  setEventStreamHeaders,
  formatEventStreamComment,
  formatEventStreamMessage,
  formatEventStreamMessages,
} from "./internal/event-stream.ts";

const _noop = () => {};

/**
 * Options for the {@link EventStream} constructor.
 *
 * Currently empty — reserved for future configuration.
 */
export interface EventStreamOptions {}

/**
 * See https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#fields
 */
export interface EventStreamMessage {
  id?: string;
  event?: string;
  retry?: number;
  data: string;
}

/**
 * A helper class for [server sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format)
 *
 * Extends {@link HTTPResponse} so it can be returned directly from a handler
 * (`return eventStream`) — `toResponse` already renders any `HTTPResponse` as
 * the response, streaming the readable side with the SSE headers below.
 *
 * @example
 *
 * ```ts
 * import { EventStream } from "h3";
 *
 * app.get("/sse", (event) => {
 *   const eventStream = new EventStream(event);
 *
 *   // Send a message every second
 *   const interval = setInterval(async () => {
 *     await eventStream.push("Hello world");
 *   }, 1000);
 *
 *   // cleanup the interval when the connection is terminated
 *   eventStream.onClosed(() => clearInterval(interval));
 *
 *   return eventStream;
 * });
 * ```
 */
export class EventStream extends HTTPResponse {
  private readonly _event: H3Event;
  private readonly _transformStream: TransformStream;
  private readonly _writer: WritableStreamDefaultWriter;
  private readonly _encoder: TextEncoder = new TextEncoder();

  private readonly _closeCallbacks: (() => any)[] = [];

  private _writerIsClosed = false;
  private _paused = false;
  private _unsentData: undefined | string;
  private _disposed = false;

  private get _isClosed(): boolean {
    return this._writerIsClosed || this._disposed;
  }

  constructor(event: H3Event, _opts: EventStreamOptions = {}) {
    // The transform stream must exist before `super()` so the readable side can
    // be handed to HTTPResponse as the body; a field initializer would run after
    // super() and replace it with a different stream, orphaning that body.
    const transformStream = new TransformStream();
    super(transformStream.readable, { status: 200, headers: eventStreamHeaders(event) });
    this._event = event;
    this._transformStream = transformStream;
    this._writer = transformStream.writable.getWriter();
    // `closed` rejects when the readable side is cancelled (client disconnect)
    // and resolves on a graceful `close()`. Both mean the stream is over.
    this._writer.closed.catch(_noop).finally(() => {
      this._writerIsClosed = true;
      this._disposed = true;
      for (const cb of this._closeCallbacks.splice(0)) {
        _invokeCloseCallback(cb);
      }
    });
    // End-of-event covers every runtime: normal end, client disconnect, and
    // a stream that is created but never `send()`-ed (the response completed
    // without it) all converge here.
    onDispose(this._event, () => this.close());
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
      // Data buffered while paused is still owed to the client. `flush()`
      // short-circuits once closed, so this is the last chance to send it.
      this._paused = false;
      await this.flush();
      try {
        await this._writer.close();
      } catch {
        // Ignore
      }
    }
    this._disposed = true;
  }

  /**
   * Triggers callback when the stream is closed, either by calling the
   * `close()` method or when the client disconnects.
   */
  onClosed(cb: () => any): void {
    if (this._writerIsClosed) {
      queueMicrotask(() => _invokeCloseCallback(cb));
      return;
    }
    this._closeCallbacks.push(cb);
  }

  /**
   * Return the readable side of the stream, staging the SSE headers on the event.
   *
   * @deprecated Return the stream itself instead (`return eventStream`) — it
   * carries the same headers via {@link HTTPResponse}. Kept for compatibility
   * with the `return eventStream.send()` pattern.
   */
  async send(): Promise<BodyInit> {
    setEventStreamHeaders(this._event);
    this._event.res.status = 200;
    return this._transformStream.readable;
  }
}

// Close callbacks are user code: never let a sync throw or a rejected async
// callback escape (the documented `onClosed` example is async).
function _invokeCloseCallback(cb: () => any): void {
  try {
    const res = cb();
    if (res instanceof Promise) {
      res.catch(_noop);
    }
  } catch {
    // Ignore
  }
}

export function isEventStream(input: unknown): input is EventStream {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  return input instanceof EventStream;
}
