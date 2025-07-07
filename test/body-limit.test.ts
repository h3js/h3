import { describe, it, expect } from "vitest";
import { defineBodySizeLimitPlugin, defineRoute } from "../src/index.ts";
import { H3 } from "../src/h3.ts";

describe("defineBodySizeLimitPlugin", () => {
  it("should limit body size for all routes", async () => {
    const app = new H3();

    // Register body size limit plugin
    const bodySizeLimit = defineBodySizeLimitPlugin({
      maxSize: 1024, // 1KB
    });
    app.register(bodySizeLimit);

    // Register a route
    app.on("POST", "/upload", () => "ok");

    // Test with small body (should succeed)
    const smallBody = "a".repeat(500);
    const smallRes = await app.fetch("/upload", {
      method: "POST",
      body: smallBody,
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": String(smallBody.length),
      },
    });
    expect(await smallRes.text()).toBe("ok");

    // Test with large body (should fail)
    const largeBody = "a".repeat(2000);
    const largeRes = await app.fetch("/upload", {
      method: "POST",
      body: largeBody,
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": String(largeBody.length),
      },
    });
    expect(largeRes.status).toBe(413);
    const error = await largeRes.json();
    expect(error.statusText).toBe("Payload Too Large");
  });

  it("should limit body size only for specified routes", async () => {
    const app = new H3();

    // Register body size limit plugin for specific routes
    const bodySizeLimit = defineBodySizeLimitPlugin({
      maxSize: 1024, // 1KB
      routes: ["/api/upload", /^\/api\/files/],
    });
    app.register(bodySizeLimit);

    // Register routes
    app.on("POST", "/api/upload", () => "upload ok");
    app.on("POST", "/api/files/test", () => "files ok");
    app.on("POST", "/other", () => "other ok");

    const largeBody = "a".repeat(2000);

    // Should fail for /api/upload
    const uploadRes = await app.fetch("/api/upload", {
      method: "POST",
      body: largeBody,
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": String(largeBody.length),
      },
    });
    expect(uploadRes.status).toBe(413);

    // Should fail for /api/files/test
    const filesRes = await app.fetch("/api/files/test", {
      method: "POST",
      body: largeBody,
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": String(largeBody.length),
      },
    });
    expect(filesRes.status).toBe(413);

    // Should succeed for /other
    const otherRes = await app.fetch("/other", {
      method: "POST",
      body: largeBody,
      headers: {
        "Content-Type": "text/plain",
      },
    });
    expect(await otherRes.text()).toBe("other ok");
  });

  it("should exclude specified routes from limit", async () => {
    const app = new H3();

    // Register body size limit plugin with exclusions
    const bodySizeLimit = defineBodySizeLimitPlugin({
      maxSize: 1024, // 1KB
      exclude: ["/api/large-upload"],
    });
    app.register(bodySizeLimit);

    // Register routes
    app.on("POST", "/api/upload", () => "upload ok");
    app.on("POST", "/api/large-upload", () => "large upload ok");

    const largeBody = "a".repeat(2000);

    // Should fail for /api/upload
    const uploadRes = await app.fetch("/api/upload", {
      method: "POST",
      body: largeBody,
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": String(largeBody.length),
      },
    });
    expect(uploadRes.status).toBe(413);

    // Should succeed for /api/large-upload (excluded)
    const largeUploadRes = await app.fetch("/api/large-upload", {
      method: "POST",
      body: largeBody,
      headers: {
        "Content-Type": "text/plain",
      },
    });
    expect(await largeUploadRes.text()).toBe("large upload ok");
  });

  it("should work with defineRoute", async () => {
    const app = new H3();

    // Register body size limit plugin
    const bodySizeLimit = defineBodySizeLimitPlugin({
      maxSize: 1024, // 1KB
    });
    app.register(bodySizeLimit);

    // Register route using defineRoute
    const uploadRoute = defineRoute({
      method: "POST",
      route: "/upload",
      handler: () => "ok",
    });
    app.register(uploadRoute);

    // Test with large body (should fail)
    const largeBody = "a".repeat(2000);
    const largeRes = await app.fetch("/upload", {
      method: "POST",
      body: largeBody,
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": String(largeBody.length),
      },
    });
    expect(largeRes.status).toBe(413);
  });
});
