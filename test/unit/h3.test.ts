import { describe, it, vi, expect } from "vitest";
import { H3 } from "../../src/h3.ts";

describe("H3", () => {
  it("plugins work", () => {
    const plugin = vi.fn();
    const app = new H3({ plugins: [plugin] });
    expect(plugin).toHaveBeenCalledWith(app);
  });
});
