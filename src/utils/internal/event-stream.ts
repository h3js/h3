import type { H3Event } from "../../event.ts";
import type { EventStreamMessage } from "../event-stream.ts";

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

export function eventStreamHeaders(event: H3Event): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "text/event-stream",
    "cache-control": "private, no-cache, no-store, no-transform, must-revalidate, max-age=0",
    // prevent nginx from buffering the response
    "x-accel-buffering": "no",
  };
  if (event.req.headers.get("connection") === "keep-alive") {
    headers["connection"] = "keep-alive";
  }
  return headers;
}

export function setEventStreamHeaders(event: H3Event): void {
  for (const [name, value] of Object.entries(eventStreamHeaders(event))) {
    event.res.headers.set(name, value);
  }
}
