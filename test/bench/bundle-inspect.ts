/**
 * Bundle a minimal H3 app (new H3() + one route) into a temp dir as readable,
 * fully tree-shaken ESM for inspection.
 *
 * Usage:
 *   node test/bench/bundle-inspect.ts
 *   node test/bench/bundle-inspect.ts --entry=node --external
 *   node test/bench/bundle-inspect.ts --bundler=esbuild --out=/tmp/h3-bundle
 *
 * Flags:
 *   --entry=<name>     h3 entry to bundle: index (default), node, bun, deno,
 *                      cloudflare, service-worker, generic
 *   --bundler=<name>   rolldown (default, same bundler as `pnpm build`) or esbuild
 *   --out=<dir>        output dir (default: mkdtemp in os.tmpdir())
 *   --external         keep runtime deps (rou3, srvx) external instead of bundling
 *   --minify           minify the output (off by default)
 *   --serve            include `serve(app)` in the app (pulls in the server layer)
 */

import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const rootDir = fileURLToPath(new URL("../../", import.meta.url));

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ??
  (args.includes(`--${name}`) ? "" : fallback);

const entryName = flag("entry", "index")!;
const bundlerName = flag("bundler", "rolldown")!;
const external = flag("external") !== undefined;
const minify = flag("minify") !== undefined;
const withServe = flag("serve") !== undefined;

const h3Entry =
  entryName === "index"
    ? join(rootDir, "src/index.ts")
    : join(rootDir, `src/_entries/${entryName}.ts`);

// Runtime deps are bundled by default so the output shows the full request -> response path.
// `crossws` is an optional peer dep and always stays external.
const externals = external ? ["rou3", /^srvx(\/.*)?$/, /^crossws(\/.*)?$/] : [/^crossws(\/.*)?$/];

const outDir = flag("out")
  ? resolve(flag("out")!)
  : await mkdtemp(join(tmpdir(), `h3-bundle-${entryName}-`));
await mkdir(outDir, { recursive: true });

// --- The minimal app under inspection ---

const appSource = /* ts */ `import { H3${withServe ? ", serve" : ""} } from "h3";

export const app = new H3();

app.get("/hello/:name", (event) => {
  return { message: \`Hello, \${event.context.params!.name}!\` };
});
${withServe ? "\nserve(app);\n" : ""}
export default app;
`;

const appPath = join(outDir, "app.ts");
await writeFile(appPath, appSource);

// --- Bundle ---

interface ModuleSize {
  name: string;
  bytes: number;
}

let usedBundler = bundlerName;

const bundlePath = join(outDir, "bundle.mjs");
const modules: ModuleSize[] =
  bundlerName === "esbuild"
    ? await bundleWithEsbuild()
    : (await loadRolldown())
      ? await bundleWithRolldown()
      : await bundleWithEsbuild(true);

// --- Report ---

const code = await readFile(bundlePath);
const gzip = zlib.gzipSync(code).byteLength;
const brotli = zlib.brotliCompressSync(code).byteLength;

const kb = (n: number) => `${(n / 1024).toFixed(2)} kB`;

console.log(`\nh3 bundle inspect — entry: h3/${entryName}, bundler: ${usedBundler}`);
console.log(`  app:    ${appPath}`);
console.log(`  bundle: ${bundlePath}`);
console.log(
  `  size:   ${kb(code.byteLength)} raw · ${kb(gzip)} gzip · ${kb(brotli)} brotli` +
    `${minify ? " (minified)" : ""}`,
);
console.log(`  deps:   ${external ? "external" : "bundled"}`);

if (modules.length > 0) {
  const total = modules.reduce((sum, m) => sum + m.bytes, 0);
  console.log(`\n  per-module (${modules.length} modules, ${kb(total)} in output):`);
  const pad = Math.max(...modules.map((m) => m.name.length));
  for (const m of modules) {
    const bar = "█".repeat(Math.max(1, Math.round((m.bytes / modules[0].bytes) * 24)));
    console.log(
      `    ${m.name.padEnd(pad)}  ${String(m.bytes).padStart(6)}  ${((m.bytes / total) * 100).toFixed(1).padStart(4)}%  ${bar}`,
    );
  }
}

console.log("");

// --- Bundlers ---

// Structurally typed rather than `typeof import("rolldown")`: rolldown is not a
// direct dependency, so the specifier does not resolve for `tsc` either.
type Rolldown = {
  rolldown: (options: Record<string, unknown>) => Promise<{
    write: (options: Record<string, unknown>) => Promise<{
      output: { type: string; modules?: Record<string, { renderedLength?: number }> }[];
    }>;
    close: () => Promise<void>;
  }>;
};

async function loadRolldown(): Promise<Rolldown | undefined> {
  // rolldown is not a direct dependency; it comes in transitively via obuild.
  for (const specifier of ["rolldown", resolveVia("obuild/config", "rolldown")]) {
    if (!specifier) continue;
    try {
      return await import(specifier);
    } catch {
      // try next
    }
  }
}

function resolveVia(from: string, request: string): string | undefined {
  try {
    const req = createRequire(createRequire(import.meta.url).resolve(from, { paths: [rootDir] }));
    return req.resolve(request);
  } catch {
    return undefined;
  }
}

async function bundleWithRolldown(): Promise<ModuleSize[]> {
  const { rolldown } = (await loadRolldown())!;
  const bundle = await rolldown({
    input: appPath,
    platform: "neutral",
    external: externals,
    resolve: { alias: { h3: h3Entry } },
    treeshake: true,
    logLevel: "warn",
  });
  const { output } = await bundle.write({
    dir: outDir,
    entryFileNames: "bundle.mjs",
    format: "esm",
    minify,
    sourcemap: false,
    codeSplitting: false,
  });
  await bundle.close();
  const chunk = output.find((o) => o.type === "chunk");
  return Object.entries(chunk?.modules ?? {})
    .map(([id, m]) => ({ name: shortName(id), bytes: m.renderedLength ?? 0 }))
    .filter((m) => m.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
}

async function bundleWithEsbuild(fallback = false): Promise<ModuleSize[]> {
  if (fallback) {
    console.warn("rolldown unavailable, falling back to esbuild");
  }
  usedBundler = "esbuild";
  const { build } = await import("esbuild");
  const res = await build({
    entryPoints: [appPath],
    bundle: true,
    outfile: bundlePath,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["import", "default"],
    target: "esnext",
    treeShaking: true,
    minify,
    keepNames: true,
    legalComments: "none",
    metafile: true,
    external: externals.map((e) =>
      typeof e === "string" ? e : e.source.replace(/^\^|\(.*$/g, ""),
    ),
    alias: { h3: h3Entry },
    logOverride: { "ignored-bare-import": "silent" },
  });
  await writeFile(join(outDir, "meta.json"), JSON.stringify(res.metafile, null, 2));
  const out =
    res.metafile.outputs[relative(process.cwd(), bundlePath)] ??
    Object.values(res.metafile.outputs)[0];
  return Object.entries(out?.inputs ?? {})
    .map(([id, m]) => ({ name: shortName(id), bytes: m.bytesInOutput }))
    .filter((m) => m.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
}

function shortName(id: string): string {
  const abs = id.startsWith("file://") ? fileURLToPath(id) : resolve(id);
  const rel = relative(rootDir, abs);
  return rel.startsWith("..")
    ? abs.slice(abs.lastIndexOf("/") + 1) // the generated app entry, in the temp dir
    : rel.replace(/^node_modules\/\.pnpm\/[^/]+\/node_modules\//, "");
}
