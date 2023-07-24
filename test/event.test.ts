import supertest, { SuperTest, Test } from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import {
  createApp,
  App,
  toNodeListener,
  eventHandler,
  getMethod,
} from "../src";

const supportsHeaders = typeof Headers !== "undefined";

describe("Event", () => {
  let app: App;
  let request: SuperTest<Test>;

  beforeEach(() => {
    app = createApp({ debug: false });
    request = supertest(toNodeListener(app));
  });

  it("can read the method", async () => {
    app.use(
      "/",
      eventHandler((event) => {
        expect(event.method).toBe(getMethod(event));
        expect(event.method).toBe("POST");
        return "200";
      })
    );
    const result = await request.post("/hello");
    expect(result.text).toBe("200");
  });

  it.runIf(supportsHeaders)("can read the headers", async () => {
    app.use(
      "/",
      eventHandler((event) => {
        return {
          headers: [...event.headers.entries()],
        };
      })
    );
    const result = await request
      .post("/hello")
      .set("X-Test", "works")
      .set("Cookie", ["a", "b"]);
    const { headers } = JSON.parse(result.text);
    expect(headers.find(([key]) => key === "x-test")[1]).toBe("works");
    expect(headers.find(([key]) => key === "cookie")[1]).toBe("a; b");
  });
});
