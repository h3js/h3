import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

describe("benchmark", () => {
  it("bundle size", async () => {
    const code = /* js */ `
      // import { H3 } from "../../dist/index.mjs.ts";
      import { H3 } from "../../src/index.ts";
      export default new H3();
    `;

    // Node.js
    const nodeBundle = await getBundleSize(code, ["node"]);
    // console.log( `Bundle size: (node) ${nodeBundle.bytes} (gzip: ${nodeBundle.gzipSize})` );
    expect(nodeBundle.bytes).toBeLessThanOrEqual(15_000); // <15kb
    expect(nodeBundle.gzipSize).toBeLessThanOrEqual(5100); // <5.1kb

    // Deno
    const denoBundle = await getBundleSize(code, ["deno"]);
    // console.log(`Bundle size: (deno) ${denoBundle.bytes} (gzip: ${denoBundle.gzipSize})` );
    expect(denoBundle.bytes).toBeLessThanOrEqual(12_000); // <12kb
    expect(denoBundle.gzipSize).toBeLessThanOrEqual(4200); // <4.2kb
  });
});

async function getBundleSize(code: string, conditions: string[]) {
  const res = await build({
    bundle: true,
    metafile: true,
    write: false,
    minify: true,
    format: "esm",
    platform: "node",
    outfile: "index.mjs",
    conditions,
    stdin: {
      contents: code,
      resolveDir: fileURLToPath(new URL(".", import.meta.url)),
      sourcefile: "index.mjs",
      loader: "js",
    },
  });
  const { bytes } = res.metafile.outputs["index.mjs"];
  const gzipSize = zlib.gzipSync(res.outputFiles[0].text).byteLength;
  return { bytes, gzipSize };
}
