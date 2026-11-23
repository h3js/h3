import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { H3, serveStaticDir } from "../src/_entries/node.ts";

describe("serveStaticDir (node)", () => {
  let rootDir: string;

  beforeAll(() => {
    rootDir = mkdtempSync(join(tmpdir(), "h3-serve-static-dir-"));
    mkdirSync(join(rootDir, "nested"));
    writeFileSync(join(rootDir, "hello.txt"), "hello world");
    writeFileSync(join(rootDir, "index.html"), "<h1>Home</h1>");
    writeFileSync(join(rootDir, "nested", "app.js"), "console.log(1);");
  });

  afterAll(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("serves files and directory index from local directory", async () => {
    const app = new H3().all("/**", (event) =>
      serveStaticDir(event, { dir: rootDir }),
    );

    const fileRes = await app.request("/hello.txt");
    expect(fileRes.status).toBe(200);
    expect(await fileRes.text()).toBe("hello world");

    const indexRes = await app.request("/");
    expect(indexRes.status).toBe(200);
    expect(await indexRes.text()).toBe("<h1>Home</h1>");

    const nestedRes = await app.request("/nested/app.js");
    expect(nestedRes.status).toBe(200);
    expect(await nestedRes.text()).toBe("console.log(1);");
  });

  it("strips base prefix and supports fallthrough", async () => {
    const app = new H3()
      .all("/assets/**", (event) =>
        serveStaticDir(event, {
          dir: rootDir,
          base: "/assets",
          fallthrough: true,
        }),
      )
      .get("/assets/missing", () => "fallback");

    const hit = await app.request("/assets/hello.txt");
    expect(hit.status).toBe(200);
    expect(await hit.text()).toBe("hello world");

    const miss = await app.request("/assets/missing");
    expect(miss.status).toBe(200);
    expect(await miss.text()).toBe("fallback");
  });

  it("blocks path traversal and returns 404 for missing files", async () => {
    const app = new H3().all("/**", (event) =>
      serveStaticDir(event, { dir: rootDir }),
    );

    const traversal = await app.request("/../package.json");
    expect(traversal.status).toBe(404);

    const missing = await app.request("/does-not-exist.txt");
    expect(missing.status).toBe(404);
  });
});
