import { describeMatrix } from "../_setup.ts";
import { decodePathname } from "../../src/utils/internal/path.ts";

describeMatrix("path utilities", (_ctx, { describe, expect, it }) => {
  describe("decodePathname", () => {
    it("returns malformed percent-encoded pathnames unchanged", () => {
      const malformed = ["/%E0%A4", "/%80", "/%FF"];

      for (const pathname of malformed) {
        expect(decodePathname(pathname)).toBe(pathname);
      }
    });

    it("decodes valid encoded segments", () => {
      expect(decodePathname("/api/%61dmin/users")).toBe("/api/admin/users");
    });

    it("preserves encoded percent", () => {
      expect(decodePathname("/api/%2561dmin/users")).toBe("/api/%2561dmin/users");
    });
  });
});
