import express from "express";
import createConnectApp from "connect";
import { describe, it, expect, beforeEach } from "vitest";
import supertest, { SuperTest, Test } from "supertest";
import { createElement } from "react";
import { renderToString, renderToPipeableStream } from "react-dom/server";
import {
  createApp,
  App,
  toNodeListener,
  fromNodeMiddleware,
  eventHandler,
} from "../src";

describe("integration with react", () => {
  let app: App;
  let request: SuperTest<Test>;

  beforeEach(() => {
    app = createApp({ debug: true });
    request = supertest(toNodeListener(app));
  });

  it("renderToString", async () => {
    app.use(
      "/",
      eventHandler(() => {
        const el = createElement("h1", null, `Hello`);
        return renderToString(el);
      }),
    );
    const res = await request.get("/");
    expect(res.text).toBe("<h1>Hello</h1>");
  });

  it("renderToPipeableStream", async () => {
    app.use(
      "/",
      eventHandler(() => {
        const el = createElement("h1", null, `Hello`);
        return renderToPipeableStream(el);
      }),
    );
    const res = await request.get("/");
    expect(res.text).toBe("<h1>Hello</h1>");
  });
});

describe("integration with express", () => {
  let app: App;
  let request: SuperTest<Test>;

  beforeEach(() => {
    app = createApp({ debug: false });
    request = supertest(toNodeListener(app));
  });

  it("can wrap an express instance", async () => {
    const expressApp = express();
    expressApp.use("/", (_req, res) => {
      res.json({ express: "works" });
    });
    app.use("/api/express", fromNodeMiddleware(expressApp));
    const res = await request.get("/api/express");

    expect(res.body).toEqual({ express: "works" });
  });

  it("can be used as express middleware", async () => {
    const expressApp = express();
    app.use(
      "/api/hello",
      fromNodeMiddleware((_req, res, next) => {
        (res as any).prop = "42";
        next();
      }),
    );
    app.use(
      "/api/hello",
      fromNodeMiddleware((req, res) => ({
        url: req.url,
        prop: (res as any).prop,
      })),
    );
    expressApp.use("/api", toNodeListener(app));

    const res = await request.get("/api/hello");

    expect(res.body).toEqual({ url: "/", prop: "42" });
  });

  it("can wrap a connect instance", async () => {
    const connectApp = createConnectApp();
    connectApp.use("/api/connect", (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ connect: "works" }));
    });
    app.use("/", fromNodeMiddleware(connectApp));
    const res = await request.get("/api/connect");

    expect(res.body).toEqual({ connect: "works" });
  });

  it("can be used as connect middleware", async () => {
    const connectApp = createConnectApp();
    app.use(
      "/api/hello",
      fromNodeMiddleware((_req, res, next) => {
        (res as any).prop = "42";
        next();
      }),
    );
    app.use(
      "/api/hello",
      fromNodeMiddleware((req, res) => ({
        url: req.url,
        prop: (res as any).prop,
      })),
    );
    connectApp.use("/api", app);

    const res = await request.get("/api/hello");

    expect(res.body).toEqual({ url: "/", prop: "42" });
  });
});
