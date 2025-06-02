import { describe, it, expect } from "vitest";
import { requests } from "./input.ts";
import { createInstances } from "./bench.impl.ts";

describe("benchmark", async () => {
  const instances = await createInstances();

  describe("app works as expected", () => {
    for (const [name, _fetch] of instances) {
      for (const request of requests) {
        it(`[${name}] [${request.method}] ${request.path}`, async () => {
          const response = await _fetch(
            new Request(`http://localhost${request.path}`, {
              method: request.method,
              body: request.body,
            }),
          );
          if (request.response.body) {
            expect(await response.text()).toBe(request.response.body);
          }
          if (request.response.headers) {
            for (const [key, value] of Object.entries(
              request.response.headers,
            )) {
              expect(response.headers.get(key)).toBe(value);
            }
          }
          expect(response.status).toBe(200);
        });
      }
    }
  });
});
