import type { H3 } from "../types/h3.ts";

export interface TestClientOptions {
  /** Request headers */
  headers?: HeadersInit;
  /** Request body (objects are auto-serialized as JSON) */
  body?: BodyInit | Record<string, unknown> | unknown[] | null;
  /** Query parameters */
  query?: Record<string, string>;
}

interface TestClientResult {
  /** Make a raw request and get the Response */
  request(path: string, opts?: TestClientOptions & { method?: string }): Promise<Response>;

  /** GET request, returns parsed response */
  $fetch(path: string, opts?: TestClientOptions & { method?: string }): Promise<unknown>;

  /** GET request */
  get(path: string, opts?: TestClientOptions): Promise<unknown>;
  /** POST request */
  post(path: string, opts?: TestClientOptions): Promise<unknown>;
  /** PUT request */
  put(path: string, opts?: TestClientOptions): Promise<unknown>;
  /** PATCH request */
  patch(path: string, opts?: TestClientOptions): Promise<unknown>;
  /** DELETE request */
  delete(path: string, opts?: TestClientOptions): Promise<unknown>;
}

/**
 * Create a lightweight test client for an H3 app.
 *
 * The client runs requests in-process via `app.request()` — no server needed.
 *
 * - Objects in `body` are auto-serialized as JSON with appropriate headers
 * - `$fetch` and method helpers auto-parse JSON responses
 * - Non-ok responses throw the parsed error body
 *
 * @example
 * ```ts
 * const app = new H3().get("/hello", () => ({ message: "world" }));
 * const client = createTestClient(app);
 *
 * const data = await client.get("/hello");
 * // { message: "world" }
 *
 * const res = await client.request("/hello");
 * // Raw Response object
 * ```
 */
export function createTestClient(app: H3): TestClientResult {
  function request(
    path: string,
    opts?: TestClientOptions & { method?: string },
  ): Promise<Response> {
    const { body, headers, query, method, ...rest } = opts || {};

    let url = path;
    if (query) {
      const params = new URLSearchParams(query);
      url += (url.includes("?") ? "&" : "?") + params.toString();
    }

    const init: RequestInit = { method, ...rest };

    if (body !== null && body !== undefined && typeof body === "object" && !isBodyInit(body)) {
      init.body = JSON.stringify(body);
      init.headers = new Headers(headers);
      if (!init.headers.has("content-type")) {
        init.headers.set("content-type", "application/json");
      }
    } else {
      init.body = body as BodyInit;
      if (headers) {
        init.headers = new Headers(headers);
      }
    }

    return Promise.resolve(app.request(url, init));
  }

  async function $fetch(
    path: string,
    opts?: TestClientOptions & { method?: string },
  ): Promise<unknown> {
    const res = await request(path, opts);
    const contentType = res.headers.get("content-type") || "";
    const data = contentType.includes("json") ? await res.json() : await res.text();
    if (!res.ok) {
      throw Object.assign(new Error(res.statusText || `${res.status}`), {
        status: res.status,
        data,
        response: res,
      });
    }
    return data;
  }

  return {
    request,
    $fetch,
    get: (path, opts) => $fetch(path, { ...opts, method: "GET" }),
    post: (path, opts) => $fetch(path, { ...opts, method: "POST" }),
    put: (path, opts) => $fetch(path, { ...opts, method: "PUT" }),
    patch: (path, opts) => $fetch(path, { ...opts, method: "PATCH" }),
    delete: (path, opts) => $fetch(path, { ...opts, method: "DELETE" }),
  };
}

function isBodyInit(value: unknown): value is BodyInit {
  return (
    value instanceof ArrayBuffer ||
    value instanceof Blob ||
    value instanceof FormData ||
    value instanceof ReadableStream ||
    value instanceof URLSearchParams ||
    ArrayBuffer.isView(value)
  );
}
