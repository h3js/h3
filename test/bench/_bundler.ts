/**
 * Shared bundling glue for the `*-bundle-inspect.ts` scripts: bundle one entry
 * into readable, fully tree-shaken ESM with rolldown (same bundler as
 * `pnpm build`) or esbuild, and report the per-module byte breakdown.
 *
 * Not a test helper — nothing here is imported by the suite.
 */

import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

export type BundlerName = "rolldown" | "esbuild";

export interface ModuleSize {
  /** Module id, shortened relative to `rootDir`. */
  name: string;
  /** Bytes this module contributes to the output. */
  bytes: number;
}

export interface BundleOptions {
  /** Entry file. */
  entry: string;
  /** Output file (ESM). */
  outFile: string;
  /**
   * **Exact** specifier → file map, applied as a resolve plugin rather than the
   * bundlers' `alias` option: both alias implementations also rewrite subpaths
   * (`h3` would capture `h3/rules`), which would silently mis-resolve the
   * subpath entries these scripts care about.
   */
  alias?: Record<string, string>;
  external?: (string | RegExp)[];
  minify?: boolean;
  bundler?: BundlerName;
  /** Root the returned module names are made relative to. */
  rootDir: string;
  /** Write esbuild's metafile here (esbuild only). */
  metaFile?: string;
}

export interface BundleResult {
  /** The bundler actually used (rolldown falls back to esbuild when absent). */
  bundler: BundlerName;
  modules: ModuleSize[];
}

export interface Sizes {
  raw: number;
  gzip: number;
  brotli: number;
}

/** Bundle `entry` to `outFile` as ESM. */
export async function bundleModule(opts: BundleOptions): Promise<BundleResult> {
  if ((opts.bundler ?? "rolldown") === "rolldown") {
    const rolldown = await loadRolldown(opts.rootDir);
    if (rolldown) {
      return { bundler: "rolldown", modules: await bundleWithRolldown(rolldown, opts) };
    }
    console.warn("rolldown unavailable, falling back to esbuild");
  }
  return { bundler: "esbuild", modules: await bundleWithEsbuild(opts) };
}

/** Raw / gzip / brotli sizes of a built file. */
export async function sizesOf(file: string): Promise<Sizes> {
  const code = await readFile(file);
  return {
    raw: code.byteLength,
    gzip: zlib.gzipSync(code).byteLength,
    brotli: zlib.brotliCompressSync(code).byteLength,
  };
}

export function kb(n: number): string {
  return `${(n / 1024).toFixed(2)} kB`;
}

/** Print a per-module breakdown (largest first, bar scaled to the largest). */
export function printModules(modules: ModuleSize[], indent = "  "): void {
  if (modules.length === 0) {
    return;
  }
  const total = modules.reduce((sum, m) => sum + m.bytes, 0);
  console.log(`${indent}per-module (${modules.length} modules, ${kb(total)} in output):`);
  const pad = Math.max(...modules.map((m) => m.name.length));
  for (const m of modules) {
    const bar = "█".repeat(Math.max(1, Math.round((m.bytes / modules[0]!.bytes) * 24)));
    console.log(
      `${indent}  ${m.name.padEnd(pad)}  ${String(m.bytes).padStart(6)}  ${((m.bytes / total) * 100).toFixed(1).padStart(4)}%  ${bar}`,
    );
  }
}

// ---- Internal ----

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

async function loadRolldown(rootDir: string): Promise<Rolldown | undefined> {
  // rolldown is not a direct dependency; it comes in transitively via obuild.
  for (const specifier of ["rolldown", resolveVia(rootDir, "obuild/config", "rolldown")]) {
    if (!specifier) continue;
    try {
      return await import(specifier);
    } catch {
      // try next
    }
  }
}

function resolveVia(rootDir: string, from: string, request: string): string | undefined {
  try {
    const req = createRequire(createRequire(import.meta.url).resolve(from, { paths: [rootDir] }));
    return req.resolve(request);
  } catch {
    return undefined;
  }
}

async function bundleWithRolldown(
  { rolldown }: Rolldown,
  opts: BundleOptions,
): Promise<ModuleSize[]> {
  const alias = opts.alias ?? {};
  const bundle = await rolldown({
    input: opts.entry,
    platform: "neutral",
    external: opts.external ?? [],
    plugins: [{ name: "exact-alias", resolveId: (source: string) => alias[source] ?? null }],
    treeshake: true,
    logLevel: "warn",
  });
  const { output } = await bundle.write({
    file: opts.outFile,
    format: "esm",
    minify: opts.minify,
    sourcemap: false,
    codeSplitting: false,
  });
  await bundle.close();
  const chunk = output.find((o) => o.type === "chunk");
  return Object.entries(chunk?.modules ?? {})
    .map(([id, m]) => ({ name: shortName(id, opts.rootDir), bytes: m.renderedLength ?? 0 }))
    .filter((m) => m.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
}

async function bundleWithEsbuild(opts: BundleOptions): Promise<ModuleSize[]> {
  const alias = opts.alias ?? {};
  const { build } = await import("esbuild");
  const res = await build({
    entryPoints: [opts.entry],
    bundle: true,
    outfile: opts.outFile,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["import", "default"],
    target: "esnext",
    treeShaking: true,
    minify: opts.minify,
    keepNames: true,
    legalComments: "none",
    metafile: true,
    external: (opts.external ?? []).map((e) =>
      typeof e === "string" ? e : e.source.replace(/^\^|\(.*$/g, ""),
    ),
    plugins: [
      {
        name: "exact-alias",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) =>
            alias[args.path] ? { path: alias[args.path] } : undefined,
          );
        },
      },
    ],
    logOverride: { "ignored-bare-import": "silent" },
  });
  if (opts.metaFile) {
    await writeFile(opts.metaFile, JSON.stringify(res.metafile, null, 2));
  }
  const out =
    res.metafile.outputs[relative(process.cwd(), opts.outFile)] ??
    Object.values(res.metafile.outputs)[0];
  return Object.entries(out?.inputs ?? {})
    .map(([id, m]) => ({ name: shortName(id, opts.rootDir), bytes: m.bytesInOutput }))
    .filter((m) => m.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
}

/** Module id shortened relative to `rootDir` (generated files keep their basename). */
export function shortName(id: string, rootDir: string): string {
  const abs = id.startsWith("file://") ? fileURLToPath(id) : resolve(id);
  const rel = relative(rootDir, abs);
  return rel.startsWith("..")
    ? abs.slice(abs.lastIndexOf("/") + 1) // generated entries, in the temp dir
    : rel.replace(/^node_modules\/\.pnpm\/[^/]+\/node_modules\//, "");
}
