import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const inspect = !!process.env.BUNDLE_INSPECT;

describe("benchmark", () => {
  it("bundle size", async () => {
    const code = /* js */ `
      import { H3 } from "../../src/index.ts";
      const app = new H3();
    `;
    const bundle = await getBundleSize(code);
    if (inspect) {
      return;
    }
    if (process.env.DEBUG) {
      console.log(`Bundle size:${bundle.bytes} (gzip: ${bundle.gzipSize})`);
    }
    expect(bundle.bytes).toBeLessThanOrEqual(10_000); // <10kb
    expect(bundle.gzipSize).toBeLessThanOrEqual(4000); // <4kb
  });
});

async function getBundleSize(code: string) {
  const res = await build({
    bundle: true,
    metafile: true,
    write: false,
    minify: inspect ? false : true,
    format: "esm",
    platform: "node",
    outfile: "index.mjs",
    treeShaking: true,
    conditions: ["browser"],
    stdin: {
      contents: code,
      resolveDir: fileURLToPath(new URL(".", import.meta.url)),
      sourcefile: "index.mjs",
      loader: "js",
    },
  });

  if (inspect) {
    await process
      .getBuiltinModule("node:fs/promises")
      .writeFile("bundle.tmp.mjs", res.outputFiles[0].contents);
  }

  const { bytes } = res.metafile.outputs["index.mjs"];
  const gzipSize = zlib.gzipSync(res.outputFiles[0].text).byteLength;
  return { bytes, gzipSize };
}
