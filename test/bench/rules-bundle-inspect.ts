/**
 * Audit harness for **compiled route rules** (`h3/rules/compiler`).
 *
 * Emits, for one rule set, a set of side-by-side variants — compiled vs the
 * runtime matcher, plain vs `preMerge`, standalone vs wired into an H3 app —
 * each as its own directory containing the generated module, the bundle entry
 * and the fully tree-shaken ESM bundle. Then it reports bundle size, the
 * per-module breakdown, a few core invariants (rou3 / normalize / handler deps
 * staying out of compiled bundles), and runs every variant over a shared probe
 * grid to check the compiled matchers resolve *exactly* what the runtime
 * matcher resolves.
 *
 * The fixtures use `headers` and data-only rules on purpose: the subject is the
 * rules core (codegen, router build, layer merge, override guard, bundle cost),
 * not any individual handler's implementation.
 *
 * Usage:
 *   node test/bench/rules-bundle-inspect.ts
 *   node test/bench/rules-bundle-inspect.ts --fixture=data --modules=all
 *   node test/bench/rules-bundle-inspect.ts --out=/tmp/rules-audit --bundler=esbuild
 *
 * Flags:
 *   --fixture=<name>   headers (default), data, overlap — see _rules-fixtures.ts
 *   --only=<ids>       comma-separated variant ids (default: all)
 *   --bundler=<name>   rolldown (default, same bundler as `pnpm build`) or esbuild
 *   --out=<dir>        output dir (default: mkdtemp in os.tmpdir())
 *   --modules=<id>     per-module breakdown for one variant, `all`, or `none`
 *                      (default: the first compiled variant)
 *   --external         keep runtime deps (rou3, srvx) external instead of bundling
 *                      (disables the parity run — bare specifiers stay unresolved)
 *   --minify           minify the output (off by default)
 *   --no-parity        skip the probe-grid parity run
 *
 * See also: bundle-inspect.ts (plain H3 app).
 */

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileRouteRules } from "../../src/rules/compiler.ts";
import type { CompileModuleOptions } from "../../src/rules/compiler.ts";
import { bundleModule, kb, printModules, sizesOf } from "./_bundler.ts";
import type { BundlerName, ModuleSize, Sizes } from "./_bundler.ts";
import { FIXTURES, PROBES, snapshotMatch } from "./_rules-fixtures.ts";
import type { MatchResultLike, MatchSnapshot } from "./_rules-fixtures.ts";

const rootDir = fileURLToPath(new URL("../../", import.meta.url));

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ??
  (args.includes(`--${name}`) ? "" : fallback);

const fixtureName = flag("fixture", "headers")!;
const bundlerName = flag("bundler", "rolldown")! as BundlerName;
const only = flag("only")?.split(",").filter(Boolean);
const external = flag("external") !== undefined;
const minify = flag("minify") !== undefined;
const modulesFor = flag("modules");
const parity = flag("no-parity") === undefined && !external;

const fixture = FIXTURES[fixtureName];
if (!fixture) {
  console.error(`unknown fixture \`${fixtureName}\` (have: ${Object.keys(FIXTURES).join(", ")})`);
  process.exit(1);
}

// Every specifier a generated module or entry can reference, mapped exactly
// (the compiler emits bare `h3/rules` imports for handlers and matcher infra).
const alias: Record<string, string> = {
  h3: join(rootDir, "src/index.ts"),
  "h3/rules": join(rootDir, "src/rules/index.ts"),
  "h3/rules/cache": join(rootDir, "src/rules/cache.ts"),
  "h3/rules/proxy": join(rootDir, "src/rules/proxy.ts"),
};

// Runtime deps are bundled by default so the output shows the full match path.
// `crossws` is an optional peer dep and always stays external.
const externals = external ? ["rou3", /^srvx(\/.*)?$/, /^crossws(\/.*)?$/] : [/^crossws(\/.*)?$/];

const outDir = flag("out")
  ? resolve(flag("out")!)
  : await mkdtemp(join(tmpdir(), `h3-rules-${fixtureName}-`));
await mkdir(outDir, { recursive: true });

// --- Variants ---

interface Variant {
  id: string;
  label: string;
  /** `matcher` exports `matcher(method, pathname)`; `app` exports an H3 `app`. */
  kind: "matcher" | "app";
  /** Entry module source (`entry.mjs`). */
  entry: string;
  /** Generated `rules.gen.mjs` source, for the compiled variants. */
  generated?: string;
  /** Compiler warnings captured while generating (e.g. the preMerge fallback). */
  warnings?: string[];
}

const CONFIG = JSON.stringify(fixture.config, null, 2);

/** Compile a rule set, capturing the compiler's own `console.warn` output. */
function compile(opts: CompileModuleOptions): { code: string; warnings: string[] } {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...msg: unknown[]) => void warnings.push(msg.join(" "));
  try {
    return { code: compileRouteRules(fixture.config, opts).code, warnings };
  } finally {
    console.warn = warn;
  }
}

function compiledVariant(id: string, label: string, opts: CompileModuleOptions): Variant {
  const { code, warnings } = compile(opts);
  return {
    id,
    label,
    kind: "matcher",
    generated: code,
    warnings,
    entry: `export { matcher } from "./rules.gen.mjs";\n`,
  };
}

/** An H3 app driving a compiled matcher — the wiring `routeRules()` does internally. */
const COMPILED_APP_ENTRY = /* js */ `import { H3, callMiddleware } from "h3";
import { matcher } from "./rules.gen.mjs";

export const app = new H3();

app.use((event, next) => {
  const { routeRules, routeRuleMiddleware } = matcher(
    event.req.method.toUpperCase(),
    event.url.pathname,
  );
  event.context.routeRules = routeRules;
  return routeRuleMiddleware.length > 0
    ? callMiddleware(event, routeRuleMiddleware, () => next())
    : next();
});

app.all("/**", (event) => ({ path: event.url.pathname }));
`;

const VARIANTS: Variant[] = [
  compiledVariant("compiled", "compiled matcher", { matcher: true }),
  compiledVariant("compiled-premerge", "compiled matcher, preMerge", {
    matcher: true,
    preMerge: true,
  }),
  compiledVariant("compiled-memo", "compiled matcher, memoized", {
    matcher: { memoize: true },
  }),
  {
    id: "runtime",
    label: "runtime matcher (reference)",
    kind: "matcher",
    entry: /* js */ `import { createRouteRulesMatcher, normalizeRouteRules } from "h3/rules";

export const matcher = createRouteRulesMatcher(normalizeRouteRules(${CONFIG}));
`,
  },
  // Runtime preMerge throws on a non-chain-clean set (only the compiler is
  // fail-safe), which would fail at module evaluation rather than reporting.
  ...(fixture.chainClean
    ? [
        {
          id: "runtime-premerge",
          label: "runtime matcher, preMerge",
          kind: "matcher" as const,
          entry: /* js */ `import { createRouteRulesMatcher, normalizeRouteRules } from "h3/rules";

export const matcher = createRouteRulesMatcher(normalizeRouteRules(${CONFIG}), { preMerge: true });
`,
        },
      ]
    : []),
  {
    ...compiledVariant("compiled-app", "H3 app + compiled matcher", {
      // Memoized, to match the `routeRules()` middleware default.
      matcher: { memoize: true },
    }),
    kind: "app",
    entry: COMPILED_APP_ENTRY,
  },
  {
    id: "runtime-app",
    label: "H3 app + routeRules() (reference)",
    kind: "app",
    entry: /* js */ `import { H3 } from "h3";
import { routeRules } from "h3/rules";

export const app = new H3();

app.use(routeRules(${CONFIG}));

app.all("/**", (event) => ({ path: event.url.pathname }));
`,
  },
];

const variants = only ? VARIANTS.filter((v) => only.includes(v.id)) : VARIANTS;
if (variants.length === 0) {
  console.error(`no variants selected (have: ${VARIANTS.map((v) => v.id).join(", ")})`);
  process.exit(1);
}

// --- Build ---

interface Built extends Variant {
  dir: string;
  bundlePath: string;
  sizes: Sizes;
  /** Generated-module sizes, for the compiled variants. */
  generatedSizes?: Sizes;
  modules: ModuleSize[];
  bundler: BundlerName;
}

const built: Built[] = [];

for (const variant of variants) {
  const dir = join(outDir, "variants", variant.id);
  await mkdir(dir, { recursive: true });
  if (variant.generated) {
    await writeFile(join(dir, "rules.gen.mjs"), variant.generated);
  }
  const entryPath = join(dir, "entry.mjs");
  await writeFile(entryPath, variant.entry);
  const bundlePath = join(dir, "bundle.mjs");
  const { bundler, modules } = await bundleModule({
    entry: entryPath,
    outFile: bundlePath,
    alias,
    external: externals,
    minify,
    bundler: bundlerName,
    rootDir,
    metaFile: join(dir, "meta.json"),
  });
  built.push({
    ...variant,
    dir,
    bundlePath,
    sizes: await sizesOf(bundlePath),
    generatedSizes: variant.generated ? await sizesOf(join(dir, "rules.gen.mjs")) : undefined,
    modules,
    bundler,
  });
}

// --- Core invariants (read off the module breakdown) ---

/**
 * What a compiled bundle must *not* carry — the whole point of compiling is
 * that the rou3 router, rule normalization and unused handler deps stay out.
 * `rou3` gets a byte budget rather than an absence check: h3 core re-exports
 * rou3's `NullProtoObj` as `EmptyObject` (~100 B), while the router is ~8 kB.
 */
const ROU3_ROUTER_BUDGET = 512;

interface Invariants {
  rou3Bytes: number;
  hasRou3Router: boolean;
  hasNormalize: boolean;
  hasMatch: boolean;
  hasHandlerTargetUtils: boolean;
  hasOcache: boolean;
  hasProxy: boolean;
}

function invariantsOf(modules: ModuleSize[]): Invariants {
  const bytesOf = (marker: string): number =>
    modules.filter((m) => m.name.includes(marker)).reduce((sum, m) => sum + m.bytes, 0);
  const has = (marker: string): boolean => modules.some((m) => m.name.includes(marker));
  const rou3Bytes = bytesOf("rou3");
  return {
    rou3Bytes,
    hasRou3Router: rou3Bytes > ROU3_ROUTER_BUDGET,
    hasNormalize: has("src/rules/normalize.ts"),
    hasMatch: has("src/rules/match.ts"),
    hasHandlerTargetUtils: has("src/rules/handlers/_utils.ts"),
    hasOcache: has("ocache"),
    hasProxy: has("src/utils/proxy.ts"),
  };
}

// --- Parity ---

interface Diff {
  method: string;
  pathname: string;
  reference: unknown;
  actual: unknown;
}

interface ParityReport {
  id: string;
  reference: string;
  probes: number;
  diffs: Diff[];
  error?: string;
}

/** Stable (key-sorted) serialization, so key order never reads as a difference. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

type MatcherExport = (method: string, pathname: string) => MatchResultLike;
type AppExport = { fetch: (request: Request) => Response | Promise<Response> };

async function loadBundle(variant: Built): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(variant.bundlePath).href)) as Record<string, unknown>;
}

/** Structural match snapshots per probe, for a `matcher` variant. */
async function matcherSnapshots(variant: Built): Promise<MatchSnapshot[]> {
  const { matcher } = (await loadBundle(variant)) as { matcher: MatcherExport };
  return PROBES.map(([method, pathname]) => snapshotMatch(matcher(method, pathname)));
}

/** Status + response headers + body per probe, for an `app` variant. */
async function appSnapshots(variant: Built): Promise<unknown[]> {
  const { app } = (await loadBundle(variant)) as { app: AppExport };
  const out: unknown[] = [];
  for (const [method, pathname] of PROBES) {
    const res = await app.fetch(new Request(`http://localhost${pathname}`, { method }));
    out.push({
      status: res.status,
      headers: Object.fromEntries([...res.headers].sort(([a], [b]) => (a < b ? -1 : 1))),
      body: await res.text(),
    });
  }
  return out;
}

async function checkParity(kind: Variant["kind"]): Promise<ParityReport[]> {
  const group = built.filter((v) => v.kind === kind);
  const referenceId = kind === "matcher" ? "runtime" : "runtime-app";
  const reference = group.find((v) => v.id === referenceId);
  if (!reference || group.length < 2) {
    return [];
  }
  const snapshot = kind === "matcher" ? matcherSnapshots : appSnapshots;
  const expected = await snapshot(reference);
  const reports: ParityReport[] = [];
  for (const variant of group) {
    if (variant.id === referenceId) {
      continue;
    }
    try {
      const actual = await snapshot(variant);
      const diffs: Diff[] = [];
      for (const [i, probe] of PROBES.entries()) {
        if (stable(actual[i]) !== stable(expected[i])) {
          diffs.push({
            method: probe[0],
            pathname: probe[1],
            reference: expected[i],
            actual: actual[i],
          });
        }
      }
      reports.push({ id: variant.id, reference: referenceId, probes: PROBES.length, diffs });
    } catch (error) {
      reports.push({
        id: variant.id,
        reference: referenceId,
        probes: PROBES.length,
        diffs: [],
        error: (error as Error).message,
      });
    }
  }
  return reports;
}

const parityReports = parity
  ? [...(await checkParity("matcher")), ...(await checkParity("app"))]
  : [];

// --- Report ---

console.log(
  `\nh3 compiled route rules — fixture: ${fixtureName} (${fixture.description}), bundler: ${built[0]!.bundler}`,
);
console.log(`  out:    ${outDir}`);
console.log(`  rules:  ${Object.keys(fixture.config).length} patterns`);
console.log(`  deps:   ${external ? "external" : "bundled"}${minify ? ", minified" : ""}\n`);

// Each kind is compared against its own runtime reference (a standalone
// matcher and a whole H3 app are not comparable numbers).
const baselines: Record<Variant["kind"], number | undefined> = {
  matcher: built.find((v) => v.id === "runtime")?.sizes.raw,
  app: built.find((v) => v.id === "runtime-app")?.sizes.raw,
};
const idPad = Math.max(...built.map((v) => v.id.length));
console.log(
  `  ${"variant".padEnd(idPad)}  ${"raw".padStart(9)}  ${"gzip".padStart(9)}  ${"brotli".padStart(9)}  ${"gen".padStart(8)}  vs runtime`,
);
for (const v of built) {
  const baseline = baselines[v.kind];
  const delta =
    baseline && v.id !== "runtime" && v.id !== "runtime-app"
      ? `${v.sizes.raw - baseline > 0 ? "+" : ""}${kb(v.sizes.raw - baseline)}`
      : "";
  console.log(
    `  ${v.id.padEnd(idPad)}  ${kb(v.sizes.raw).padStart(9)}  ${kb(v.sizes.gzip).padStart(9)}  ` +
      `${kb(v.sizes.brotli).padStart(9)}  ${(v.generatedSizes ? kb(v.generatedSizes.raw) : "—").padStart(8)}  ${delta}`,
  );
}

console.log(`\n  core invariants (compiled bundles must keep these out):`);
console.log(
  `  ${"variant".padEnd(idPad)}  ${"rou3".padStart(7)}  router  normalize  match  handler-utils  ocache  proxy`,
);
const mark = (on: boolean): string => (on ? "yes" : "no ");
for (const v of built) {
  const inv = invariantsOf(v.modules);
  console.log(
    `  ${v.id.padEnd(idPad)}  ${String(inv.rou3Bytes).padStart(7)}  ${mark(inv.hasRou3Router).padStart(6)}  ` +
      `${mark(inv.hasNormalize).padStart(9)}  ${mark(inv.hasMatch).padStart(5)}  ` +
      `${mark(inv.hasHandlerTargetUtils).padStart(13)}  ${mark(inv.hasOcache).padStart(6)}  ${mark(inv.hasProxy)}`,
  );
}
console.log(
  `  (the \`app\` variants carry rou3 for H3's own router — the router check is about the *rules* matcher)` +
    (external
      ? `\n  (--external: rou3 is not bundled, so its column reads 0 for every variant)`
      : ""),
);

const warned = built.filter((v) => v.warnings?.length);
if (warned.length > 0) {
  console.log(`\n  compiler warnings:`);
  for (const v of warned) {
    for (const w of v.warnings!) {
      console.log(`    [${v.id}] ${w.replace(/\n\s*/g, " ")}`);
    }
  }
}

const showModules =
  modulesFor === "none"
    ? []
    : modulesFor === "all" || modulesFor === ""
      ? built
      : built.filter(
          (v) => v.id === (modulesFor ?? built.find((b) => b.generated)?.id ?? built[0]!.id),
        );
for (const v of showModules) {
  console.log(`\n  ${v.id} — ${v.label}`);
  printModules(v.modules, "  ");
}

if (parityReports.length > 0) {
  console.log(`\n  parity (${PROBES.length} probes, vs the runtime matcher):`);
  for (const report of parityReports) {
    if (report.error) {
      console.log(`    ${report.id.padEnd(idPad)}  ERROR  ${report.error}`);
      continue;
    }
    console.log(
      `    ${report.id.padEnd(idPad)}  ${report.diffs.length === 0 ? "ok" : `${report.diffs.length} differ vs ${report.reference}`}`,
    );
    for (const diff of report.diffs) {
      console.log(`      ${diff.method} ${diff.pathname}`);
      console.log(`        ${report.reference}: ${stable(diff.reference)}`);
      console.log(`        ${report.id}: ${stable(diff.actual)}`);
    }
  }
} else if (!parity) {
  console.log(
    `\n  parity: skipped (${external ? "--external leaves bare specifiers unresolved" : "--no-parity"})`,
  );
}

// --- Artifacts ---

await writeFile(
  join(outDir, "report.json"),
  JSON.stringify(
    {
      fixture: { name: fixtureName, ...fixture },
      bundler: built[0]!.bundler,
      options: { external, minify, parity },
      probes: PROBES,
      variants: built.map((v) => ({
        id: v.id,
        label: v.label,
        kind: v.kind,
        dir: v.dir,
        sizes: v.sizes,
        generatedSizes: v.generatedSizes,
        warnings: v.warnings ?? [],
        invariants: invariantsOf(v.modules),
        modules: v.modules,
      })),
      parity: parityReports,
    },
    null,
    2,
  ),
);

await writeFile(join(outDir, "README.md"), readme());

console.log(`\n  artifacts:`);
console.log(`    ${join(outDir, "README.md")}   what each file is + audit checklist`);
console.log(`    ${join(outDir, "report.json")}  sizes, invariants, per-module, parity`);
for (const v of built) {
  console.log(`    ${v.dir}/`);
}
console.log("");

function readme(): string {
  const rows = built
    .map(
      (v) =>
        `| \`${v.id}\` | ${v.label} | ${v.kind} | ${kb(v.sizes.raw)} | ${kb(v.sizes.gzip)} | ${v.generated ? "`rules.gen.mjs`" : "—"} |`,
    )
    .join("\n");
  return `# Compiled route rules — audit bundle

Generated by \`test/bench/rules-bundle-inspect.ts\` (fixture: \`${fixtureName}\` — ${fixture.description}).

Every variant below is the *same rule set*, built a different way. Each variant
directory holds:

- \`rules.gen.mjs\` — the compiler output (\`h3/rules/compiler\`). **The primary
  artifact to audit**: this is code h3 generates into a consumer's build.
- \`entry.mjs\` — how the variant is consumed.
- \`bundle.mjs\` — the tree-shaken ESM bundle (readable unless \`--minify\`).
- \`meta.json\` — esbuild metafile (esbuild runs only as a rolldown fallback).

| variant | what | kind | raw | gzip | generated |
| --- | --- | --- | --- | --- | --- |
${rows}

\`report.json\` carries the same data in machine-readable form, plus the
per-module byte breakdown, the core invariants and the parity results.

## Rule set

\`\`\`json
${CONFIG}
\`\`\`

## What is worth auditing

**Correctness.** \`rules.gen.mjs\` must resolve exactly what the runtime matcher
resolves, for every spelling of a path a consumer can reach: encoded separators
(\`%2f\`), dot segments (\`%2e%2e\`), trailing slashes, method scoping and the
\`HEAD\` → \`GET\` fallback. The parity run in \`report.json\` covers the probe grid
in \`test/bench/_rules-fixtures.ts\`; look for cases it does *not* cover.

**Security.** The baked override predicate (the \`t\` table in the generated
matcher) is the compiled counterpart of the runtime specificity guard: an
alternate reading of the path may only override a rule with an equal or
strictly more specific pattern. Anything that lets a broader pattern replace a
narrower one is an auth-downgrade primitive. Also check the emitted literals for
injection: rule options reach the generated module through \`JSON.stringify\`, and
every emitted binding must be a valid identifier.

**Quality.** Read the generated code as code: is it what a human would write,
does it stay readable/minifiable, is the data shape (\`route\`, \`rank\`,
\`paramRoutes\`) doing real work, does \`preMerge\` earn its complexity here?

**Bundle size.** Compare the compiled variants against \`runtime\`. Compiling
exists to keep the rou3 router, rule normalization and unused handler
dependencies out of the runtime bundle — the invariants table checks exactly
that. Look at where the remaining bytes go in the per-module breakdown.
`;
}
