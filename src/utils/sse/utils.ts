import { TypedHeaders } from "../../types";
import { H3Event } from "../../event";
import { getHeader } from "../request";
import { setResponseHeaders } from "../response";
import { EventStreamMessage } from "./types";

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
  for (const line of data.split("\n")) {
    result += `data: ${line}\n`;
  }
  result += "\n";
  return result;
}

function _sanitizeSingleLine(value: string): string {
  return value.replace(/[\n\r]/g, "");
}

export function formatEventStreamMessages(
  messages: EventStreamMessage[],
): string {
  let result = "";
  for (const msg of messages) {
    result += formatEventStreamMessage(msg);
  }
  return result;
}

export function setEventStreamHeaders(event: H3Event) {
  const headers: TypedHeaders = {
    "Content-Type": "text/event-stream",
    "Cache-Control":
      "private, no-cache, no-store, no-transform, must-revalidate, max-age=0",
    "X-Accel-Buffering": "no", // prevent nginx from buffering the response
  };

  if (!isHttp2Request(event)) {
    headers.Connection = "keep-alive";
  }

  setResponseHeaders(event, headers);
}

export function isHttp2Request(event: H3Event) {
  return (
    getHeader(event, ":path") !== undefined &&
    getHeader(event, ":method") !== undefined
  );
}
