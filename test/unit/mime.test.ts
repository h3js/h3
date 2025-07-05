import { describe, expect, it } from "vitest";
import { getExtension, getType } from "../../src/utils/internal/mime.ts";

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

describe("getType", () => {
  it("returns correct MIME type for CSS", () => {
    expect(getType(".css")).toBe("text/css");
  });

  it("returns undefined for unknown extensions", () => {
    expect(getType(".xyz")).toBeUndefined();
  });

  it("returns undefined for files without extension", () => {
    expect(getType("")).toBeUndefined();
  });
});
