import express from "express";
import createConnectApp from "connect";
import { createElement } from "react";
import * as reactDom from "react-dom/server";
import {
  H3,
  toNodeHandler,
  withBase,
  fromNodeHandler,
  defineNodeHandler,
  type NodeMiddleware,
} from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

describeMatrix("integrations", (t, { it, expect, describe }) => {
  describe("react", () => {
    it("renderToString", async () => {
      t.app.get("/", () => {
        const el = createElement("h1", null, `Hello`);
        return reactDom.renderToString(el);
      });
      const res = await t.fetch("/");
      expect(await res.text()).toBe("<h1>Hello</h1>");
    });

    // renderToPipeableStream returns a Node.js stream, which is not supported in the web
    it.skipIf(t.target === "web")("renderToPipeableStream", async () => {
      t.app.get("/", () => {
        const el = createElement("h1", null, `Hello`);
        return reactDom.renderToPipeableStream(el);
      });
      const res = await t.fetch("/");
      expect(await res.text()).toBe("<h1>Hello</h1>");
    });
  });

  describe.skipIf(t.target === "web")("express", () => {
    it("can wrap an express instance", async () => {
      const expressApp = express();
      expressApp.use("/", (_req, res) => {
        res.json({ express: "works" });
      });
      t.app.use("/api/express", fromNodeHandler(expressApp as NodeMiddleware));
      const res = await t.fetch("/api/express");

      expect(await res.json()).toEqual({ express: "works" });
    });

    it("can be used as express middleware", async () => {
      const expressApp = express();
      t.app.use(
        "/api/*",
        fromNodeHandler((_req, res, next) => {
          (res as any).prop = "42";
          next();
        }),
      );
      t.app.use(
        "/api/hello",
        fromNodeHandler(
          defineNodeHandler((req, res) => {
            res.end(
              JSON.stringify({
                url: req.url,
                prop: (res as any).prop,
              }),
            );
          }),
        ),
      );
      expressApp.use("/api", toNodeHandler(t.app) as any);

      const res = await t.fetch("/api/hello");

      expect(await res.json()).toEqual({ url: "/api/hello", prop: "42" });
    });

    it("can wrap a connect instance", async () => {
      const connectApp = createConnectApp();
      connectApp.use("/api/connect", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ connect: "works" }));
      });
      t.app.use(fromNodeHandler(connectApp as NodeMiddleware));
      const res = await t.fetch("/api/connect");

      expect(await res.json()).toEqual({ connect: "works" });
    });

    it("can be used as connect middleware", async () => {
      const connectApp = createConnectApp();
      t.app.use(
        "/api/hello",
        fromNodeHandler((_req, res, next) => {
          (res as any).prop = "42";
          next?.();
        }),
      );
      t.app.use(
        "/api/hello",
        fromNodeHandler(
          defineNodeHandler((req, res) => {
            res.end(
              JSON.stringify({
                url: req.url,
                prop: (res as any).prop,
              }),
            );
          }),
        ),
      );
      connectApp.use("/api", toNodeHandler(t.app));

      const res = await t.fetch("/api/hello");

      expect(await res.json()).toEqual({ url: "/api/hello", prop: "42" });
    });

    it("can resolve nested router paths with query string", async () => {
      const connectApp = createConnectApp();
      const router = new H3().get(
        "/hello",
        (event) => event.url.searchParams.get("x") ?? "hello",
      );
      t.app.use("/api/**", withBase("/api", router));
      connectApp.use("/api", toNodeHandler(t.app));

      const res = await t.fetch("/api/hello/?x=y");
      expect(res.ok).toEqual(true);
    });
  });
});
