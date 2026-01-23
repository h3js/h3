import type { H3Event } from "../../event.ts";
import type { EventStreamMessage, EventStreamOptions } from "../event-stream.ts";

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

  constructor(event: H3Event, opts: EventStreamOptions = {}) {
    this._event = event;
    this._writer = this._transformStream.writable.getWriter();
    this._writer.closed.then(() => {
      this._writerIsClosed = true;
    });
    if (opts.autoclose !== false) {
      this._event.runtime?.node?.res?.once("close", () => this.close());
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
    if (this._writerIsClosed) {
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
    await this._writer.write(this._encoder.encode(formatEventStreamComment(comment))).catch();
  }

  private async _sendEvent(message: EventStreamMessage) {
    if (this._writerIsClosed) {
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
    await this._writer.write(this._encoder.encode(formatEventStreamMessage(message))).catch();
  }

  private async _sendEvents(messages: EventStreamMessage[]) {
    if (this._writerIsClosed) {
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

    await this._writer.write(this._encoder.encode(payload)).catch();
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
    if (this._writerIsClosed) {
      return;
    }
    if (this._unsentData?.length) {
      await this._writer.write(this._encoder.encode(this._unsentData));
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
    if (!this._writerIsClosed) {
      try {
        await this._writer.close();
      } catch {
        // Ignore
      }
    }
    this._disposed = true;
  }

  /**
   * Triggers callback when the writable stream is closed.
   * It is also triggered after calling the `close()` method.
   */
  onClosed(cb: () => any): void {
    this._writer.closed.then(cb);
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
  return `: ${comment}\n\n`;
}

export function formatEventStreamMessage(message: EventStreamMessage): string {
  let result = "";
  if (message.id) {
    result += `id: ${message.id}\n`;
  }
  if (message.event) {
    result += `event: ${message.event}\n`;
  }
  if (typeof message.retry === "number" && Number.isInteger(message.retry)) {
    result += `retry: ${message.retry}\n`;
  }
  result += `data: ${message.data}\n\n`;
  return result;
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
