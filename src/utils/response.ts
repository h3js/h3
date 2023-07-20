import type { OutgoingMessage } from "node:http";
import type { Readable } from "node:stream";
import type { Socket } from "node:net";
import type { H3Event } from "../event";
import { MIMES } from "./consts";
import { sanitizeStatusCode, sanitizeStatusMessage } from "./sanitize";
import { splitCookiesString } from "./cookie";

const defer =
  typeof setImmediate === "undefined" ? (fn: () => any) => fn() : setImmediate;

export function send(event: H3Event, data?: any, type?: string): Promise<void> {
  if (type) {
    defaultContentType(event, type);
  }
  return new Promise((resolve) => {
    defer(() => {
      if (!event.handled) {
        event.node.res.end(data);
      }
      resolve();
    });
  });
}

/**
 * Respond with an empty payload.<br>
 * Note that calling this function will close the connection and no other data can be sent to the client afterwards.
 *
 * @param event H3 event
 * @param code status code to be send. By default, it is `204 No Content`.
 */
export function sendNoContent(event: H3Event, code = 204) {
  event.node.res.statusCode = sanitizeStatusCode(code, 204);
  // 204 responses MUST NOT have a Content-Length header field (https://www.rfc-editor.org/rfc/rfc7230#section-3.3.2)
  if (event.node.res.statusCode === 204) {
    event.node.res.removeHeader("content-length");
  }
  if (!event.handled) {
    event.node.res.end();
  }
}

export function setResponseStatus(
  event: H3Event,
  code?: number,
  text?: string
): void {
  if (code) {
    event.node.res.statusCode = sanitizeStatusCode(
      code,
      event.node.res.statusCode
    );
  }
  if (text) {
    event.node.res.statusMessage = sanitizeStatusMessage(text);
  }
}

export function getResponseStatus(event: H3Event): number {
  return event.node.res.statusCode;
}

export function getResponseStatusText(event: H3Event): string {
  return event.node.res.statusMessage;
}

export function defaultContentType(event: H3Event, type?: string) {
  if (type && !event.node.res.getHeader("content-type")) {
    event.node.res.setHeader("content-type", type);
  }
}

export function sendRedirect(event: H3Event, location: string, code = 302) {
  event.node.res.statusCode = sanitizeStatusCode(
    code,
    event.node.res.statusCode
  );
  event.node.res.setHeader("location", location);
  const encodedLoc = location.replace(/"/g, "%22");
  const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=${encodedLoc}"></head></html>`;
  return send(event, html, MIMES.html);
}

export function getResponseHeaders(
  event: H3Event
): ReturnType<H3Event["res"]["getHeaders"]> {
  return event.node.res.getHeaders();
}

export function getResponseHeader(
  event: H3Event,
  name: string
): ReturnType<H3Event["res"]["getHeader"]> {
  return event.node.res.getHeader(name);
}

export function setResponseHeaders(
  event: H3Event,
  headers: Record<string, Parameters<OutgoingMessage["setHeader"]>[1]>
): void {
  for (const [name, value] of Object.entries(headers)) {
    event.node.res.setHeader(name, value);
  }
}

export const setHeaders = setResponseHeaders;

export function setResponseHeader(
  event: H3Event,
  name: string,
  value: Parameters<OutgoingMessage["setHeader"]>[1]
): void {
  event.node.res.setHeader(name, value);
}

export const setHeader = setResponseHeader;

export function appendResponseHeaders(
  event: H3Event,
  headers: Record<string, string>
): void {
  for (const [name, value] of Object.entries(headers)) {
    appendResponseHeader(event, name, value);
  }
}

export const appendHeaders = appendResponseHeaders;

export function appendResponseHeader(
  event: H3Event,
  name: string,
  value: string
): void {
  let current = event.node.res.getHeader(name);

  if (!current) {
    event.node.res.setHeader(name, value);
    return;
  }

  if (!Array.isArray(current)) {
    current = [current.toString()];
  }

  event.node.res.setHeader(name, [...current, value]);
}

export const appendHeader = appendResponseHeader;

export function isStream(data: any): data is Readable | ReadableStream {
  if (!data || typeof data !== "object") {
    return false;
  }
  // Node.js Readable Streams
  if (typeof data.pipe === "function" && typeof data.on === "function") {
    return true;
  }
  // Web Streams
  if (typeof data.pipeTo === "function") {
    return true;
  }
  return false;
}

export function isWebResponse(data: any): data is Response {
  return typeof Response !== "undefined" && data instanceof Response;
}

export function sendStream(
  event: H3Event,
  stream: Readable | ReadableStream
): Promise<void> {
  // Validate input
  if (!stream || typeof stream !== "object") {
    throw new Error("[h3] Invalid stream provided.");
  }

  // Directly expose stream for worker environments (unjs/unenv)
  (event.node.res as unknown as { _data: BodyInit })._data = stream as BodyInit;

  // Early return if response Socket is not available for worker environments (unjs/nitro)
  if (!event.node.res.socket) {
    event._handled = true;
    // TODO: Hook and handle stream errors
    return Promise.resolve();
  }

  // Native Web Streams
  if ("pipeTo" in stream) {
    return stream
      .pipeTo(
        new WritableStream({
          write(chunk) {
            event.node.res.write(chunk);
          },
        })
      )
      .then(() => {
        event.node.res.end();
      });
  }

  // Node.js Readable streams
  // https://nodejs.org/api/stream.html#readable-streams
  if ("pipe" in stream) {
    return new Promise<void>((resolve, reject) => {
      stream.pipe(event.node.res);
      stream.on("end", () => {
        event.node.res.end();
        resolve();
      });
      stream.on("error", (error: Error) => {
        reject(error);
      });
    });
  }

  throw new Error("[h3] Invalid or incompatible stream provided.");
}

const noop = () => {};
export function writeEarlyHints(
  event: H3Event,
  hints: string | string[] | Record<string, string | string[]>,
  cb: () => void = noop
) {
  if (!event.node.res.socket /* && !('writeEarlyHints' in event.node.res) */) {
    cb();
    return;
  }

  // Normalize if string or string[] is provided
  if (typeof hints === "string" || Array.isArray(hints)) {
    hints = { link: hints };
  }

  if (hints.link) {
    hints.link = Array.isArray(hints.link) ? hints.link : hints.link.split(",");
    // TODO: remove when https://github.com/nodejs/node/pull/44874 is released
    // hints.link = hints.link.map(l => l.trim().replace(/; crossorigin/g, ''))
  }

  // TODO: Enable when node 18 api is stable
  // if ('writeEarlyHints' in event.node.res) {
  //   return event.node.res.writeEarlyHints(hints, cb)
  // }

  const headers: [string, string | string[]][] = Object.entries(hints).map(
    (e) => [e[0].toLowerCase(), e[1]]
  );
  if (headers.length === 0) {
    cb();
    return;
  }

  let hint = "HTTP/1.1 103 Early Hints";
  if (hints.link) {
    hint += `\r\nLink: ${(hints.link as string[]).join(", ")}`;
  }

  for (const [header, value] of headers) {
    if (header === "link") {
      continue;
    }
    hint += `\r\n${header}: ${value}`;
  }
  if (event.node.res.socket) {
    (event.node.res as { socket: Socket }).socket.write(
      `${hint}\r\n\r\n`,
      "utf8",
      cb
    );
  } else {
    cb();
  }
}

export function sendWebResponse(event: H3Event, response: Response) {
  for (const [key, value] of response.headers) {
    if (key === "set-cookie") {
      event.node.res.appendHeader(key, splitCookiesString(value));
    } else {
      event.node.res.setHeader(key, value);
    }
  }

  if (response.status) {
    event.node.res.statusCode = sanitizeStatusCode(
      response.status,
      event.node.res.statusCode
    );
  }
  if (response.statusText) {
    event.node.res.statusMessage = sanitizeStatusMessage(response.statusText);
  }
  if (response.redirected) {
    event.node.res.setHeader("location", response.url);
  }
  if (!response.body) {
    return event.node.res.end();
  }
  return sendStream(event, response.body);
}
