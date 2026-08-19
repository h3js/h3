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
 *
 * See also: rules-bundle-inspect.ts (compiled route rules).
 */

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleModule, kb, printModules, sizesOf, type BundlerName } from "./_bundler.ts";

const rootDir = fileURLToPath(new URL("../../", import.meta.url));

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ??
  (args.includes(`--${name}`) ? "" : fallback);

const entryName = flag("entry", "index")!;
const bundlerName = flag("bundler", "rolldown")! as BundlerName;
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

const bundlePath = join(outDir, "bundle.mjs");
const { bundler, modules } = await bundleModule({
  entry: appPath,
  outFile: bundlePath,
  alias: { h3: h3Entry },
  external: externals,
  minify,
  bundler: bundlerName,
  rootDir,
  metaFile: join(outDir, "meta.json"),
});

// --- Report ---

const sizes = await sizesOf(bundlePath);

console.log(`\nh3 bundle inspect — entry: h3/${entryName}, bundler: ${bundler}`);
console.log(`  app:    ${appPath}`);
console.log(`  bundle: ${bundlePath}`);
console.log(
  `  size:   ${kb(sizes.raw)} raw · ${kb(sizes.gzip)} gzip · ${kb(sizes.brotli)} brotli` +
    `${minify ? " (minified)" : ""}`,
);
console.log(`  deps:   ${external ? "external" : "bundled"}\n`);

printModules(modules, "  ");

console.log("");
