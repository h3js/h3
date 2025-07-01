import { describe, expect, it } from "vitest";
import { getFileExtension, getMimeType } from "../src/utils/internal/mimes.ts";

describe("getFileExtension", () => {
  it("returns correct extension for CSS", () => {
    expect(getFileExtension("styles.css")).toBe(".css");
  });

  it("returns undefined for files without extension", () => {
    expect(getFileExtension("README")).toBeUndefined();
  });

  it("handles paths with dots in directory names", () => {
    expect(getFileExtension("/foo/bar.txt/baz")).toBeUndefined();
    expect(getFileExtension("/foo/bar.txt/file.css")).toBe(".css");
  });
});

describe("getMimeType", () => {
  it("returns correct MIME type for CSS", () => {
    expect(getMimeType("styles.css")).toBe("text/css");
  });

  it("returns undefined for unknown extensions", () => {
    expect(getMimeType("unknown.xyz")).toBeUndefined();
  });

  it("returns undefined for files without extension", () => {
    expect(getMimeType("README")).toBeUndefined();
  });
});
