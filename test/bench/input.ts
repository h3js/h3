// https://github.com/pi0/web-framework-benchmarks
// https://github.com/SaltyAom/bun-http-framework-benchmark

export const requests = [
  {
    method: "GET",
    path: "/",
    response: {
      body: "Hi",
    },
  },
  {
    method: "GET",
    path: "/id/id?foo=bar&name=name&bar=baz",
    response: {
      body: "id name",
      headers: {
        "x-powered-by": "benchmark",
      },
    },
  },
  {
    method: "POST",
    path: "/json",
    body: `{"hello":"world"}`,
    response: {
      body: `{"hello":"world"}`,
    },
  },
] as Array<{
  method: string;
  path: string;
  body?: string;
  response: {
    body: string;
    headers?: Record<string, string>;
  };
}>;
