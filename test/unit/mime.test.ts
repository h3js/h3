import { describe, expect, it } from "vitest";
import { getExtension, getMimeType } from "../../src/utils/internal/mime.ts";

describe("getExtension", () => {
  it("returns correct extension for CSS", () => {
    expect(getExtension("styles.css")).toBe(".css");
  });

  it("returns undefined for files without extension", () => {
    expect(getExtension("README")).toBeUndefined();
  });

  it("handles paths with dots in directory names", () => {
    expect(getExtension("/foo/bar.txt/baz")).toBeUndefined();
    expect(getExtension("/foo/bar.txt/file.css")).toBe(".css");
  });
});

describe("getMimeType", () => {
  it("returns correct MIME type for CSS", () => {
    expect(getMimeType(".css")).toBe("text/css");
  });

  it("returns undefined for unknown extensions", () => {
    expect(getMimeType(".xyz")).toBeUndefined();
  });

  it("returns undefined for files without extension", () => {
    expect(getMimeType("")).toBeUndefined();
  });
});
