import { describe, it, vi, expect } from "vitest";
import { H3 } from "../../src/h3.ts";

describe("H3", () => {
  it("plugins work", () => {
    const pluginA = vi.fn();
    const pluginB = vi.fn();
    const app = new H3({ plugins: [pluginA] }).register(pluginB);
    expect(pluginA).toHaveBeenCalledWith(app);
    expect(pluginB).toHaveBeenCalledWith(app);
  });
});
