import { compileRouter } from "rou3/compiler";
import * as _h3src from "../../src/index.ts";
// import * as _h3nightly from "h3-nightly";
import { EmptyObject } from "../../src/utils/internal/obj.ts";

type AppFetch = (req: Request) => Response | Promise<Response>;

export function createInstances(): Array<[string, AppFetch]> {
  return [
    ["std", std()], // (also does warmup)
    ["std-fast", stdFast()],
    ["h3", h3(_h3src)],
    // ["h3-nightly", h3(_h3nightly as any)],
    ["h3-compiled", h3(_h3src, true)],
    ["h3-middleware", h3Middleware(_h3src)],
  ] as const;
}

export function h3(lib: typeof _h3src, compiled?: boolean): AppFetch {
  const app = new lib.H3()
    .get("/", () => "Hi")
    .get("/id/:id", (event) => {
      event.res.headers.set("x-powered-by", "benchmark");
      const name = event.url.searchParams.get("name");
      return `${event.context.params!.id} ${name}`;
    })
    .post("/json", (event) => event.req.json());
  if (compiled) {
    const findRoute = compileRouter(app["~rou3"]);
    app["~findRoute"] = (event) =>
      findRoute(event.req.method, event.url.pathname) as any;
  }
  return app.fetch;
}

export function h3Middleware(lib: typeof _h3src): AppFetch {
  const app = new lib.H3()
    .use("/", () => new Response("Hi"))
    .use("/id/:id", (event) => {
      event.res.headers.set("x-powered-by", "benchmark");
      const name = event.url.searchParams.get("name");
      return `${event.context.middlewareParams!.id} ${name}`;
    })
    .use("/json", (event) => event.req.json());
  return app.fetch;
}

export function std() {
  return function (req: Request): Response | Promise<Response> {
    const url = new URL(req.url);
    switch (req.method) {
      case "GET": {
        if (url.pathname === "/") {
          return new Response("Hi");
        }
        if (url.pathname.startsWith("/id/")) {
          const id = url.pathname.slice(4);
          const name = url.searchParams.get("name");
          return new Response(`${id} ${name}`, {
            headers: {
              "x-powered-by": "benchmark",
            },
          });
        }
        break;
      }
      case "POST": {
        if (url.pathname === "/json") {
          return req.json().then((body) => new Response(JSON.stringify(body)));
        }
        break;
      }
    }
    return new Response("Not Found", { status: 404 });
  };
}

export function stdFast(): AppFetch {
  return (request: Request) => {
    const [pathname, query] = parseUrl(request.url);
    switch (request.method) {
      case "GET": {
        if (pathname === "/") {
          return new Response("Hi");
        }
        if (pathname.startsWith("/id/")) {
          const id = pathname.slice(4);
          const name = parseQuery(query).name;
          return new Response(`${id} ${name}`, {
            headers: {
              "x-powered-by": "benchmark",
            },
          });
        }
        break;
      }
      case "POST": {
        if (pathname === "/json") {
          return request.json().then(
            (body) =>
              new Response(JSON.stringify(body), {
                headers: {
                  "content-type": "application/json; charset=utf-8",
                },
              }),
          );
        }
        break;
      }
    }
    return new Response("Not Found", { status: 404 });
  };
}

function parseUrl(url: string) {
  const protoIndex = url.indexOf("://");
  const pIndex = url.indexOf("/", protoIndex + 3);
  const qIndex = url.indexOf("?", pIndex);
  return qIndex === -1
    ? [url.slice(pIndex), ""]
    : [url.slice(pIndex, qIndex), url.slice(qIndex + 1)];
}

function parseQuery(query: string) {
  const parts = query.split("&");
  const result = new EmptyObject();
  for (const part of parts) {
    const [key, value] = part.split("=");
    result[key] = value;
  }
  return result;
}
