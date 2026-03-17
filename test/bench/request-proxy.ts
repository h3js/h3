import { bench, summary, compact, run } from "mitata";
import { requestWithURL } from "../../src/utils/request.ts";

const req = new Request("http://localhost:3000/base/path?q=1", {
  method: "POST",
  headers: { "content-type": "application/json", "x-custom": "value" },
  body: JSON.stringify({ hello: "world" }),
});

// Pre-warmed proxy (cache populated)
const warmed = requestWithURL(req, "http://localhost:3000/path?q=1");
warmed.method;
warmed.headers;

compact(() => {
  summary(() => {
    bench("new Request(url, req)", () => {
      const url = new URL(req.url);
      url.pathname = url.pathname.slice("/base".length) || "/";
      return new Request(url, req);
    });

    bench("requestWithURL(req, url)", () => {
      return requestWithURL(req, "http://localhost:3000/path?q=1");
    });
  });

  summary(() => {
    bench("req.url", () => req.url);
    bench("proxied.url (cached)", () => warmed.url);
  });

  summary(() => {
    bench("req.method", () => req.method);
    bench("proxied.method (cold)", () => {
      const p = requestWithURL(req, "http://localhost:3000/path?q=1");
      return p.method;
    });
    bench("proxied.method (cached)", () => warmed.method);
  });

  summary(() => {
    bench("req.headers.get()", () => req.headers.get("content-type"));
    bench("proxied.headers.get() (cold)", () => {
      const p = requestWithURL(req, "http://localhost:3000/path?q=1");
      return p.headers.get("content-type");
    });
    bench("proxied.headers.get() (cached)", () => warmed.headers.get("content-type"));
  });
});

await run({ throw: true });
