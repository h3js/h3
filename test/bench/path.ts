import { bench, summary, compact, do_not_optimize, run } from "mitata";
import { resolveDotSegments } from "../../src/utils/path.ts";

// Micro-benchmarks for `resolveDotSegments`, focused on the fast-path vs
// slow-path overhead.
//
// The guard is boundary-aware: only a real `.`/`..` segment (literal or
// `%2e`-encoded), a `\`, or — with `decodeSlashes` — an encoded separator takes
// the slow path (split → per-segment normalize → join). Inputs that merely
// contain a `.` (a dotted filename) or a non-dot `%` escape (`%20`) stay on the
// fast early return. Results are fed to `do_not_optimize` so nothing is
// eliminated as dead code.

// --- Fast-path inputs: must all hit the early return unchanged ---
// A dotted filename and `%`-escaped paths are here to prove the boundary-aware
// guard keeps them cheap; before it, every `.`/`%2` dragged them onto the loop.
const FAST_PATH = [
  "/assets/app/f4a2b1c8/main.js", // dotted filename (segment-internal `.`)
  "/media/photos/albums/tripxxx", // plain path (length-matched to the above)
  "/search/foo%20bar%20/results1", // `%20` escapes, no dot segment
  "/files/userx%2fdocs/report12", // opaque `%2f` (no decodeSlashes)
  "/menu/caf%C3%A9/starters1234", // percent-encoded non-ASCII
];

// --- Slow-path pairs: genuine resolution work ---
// Fairness: each `slow` is byte-for-byte the same length and segment count as
// its `fast` twin, differing only in the char(s) that flip the guard (`.`/`%`/
// `\`). So each multiplier is the pure slow-path cost, not a length artifact.
interface Pair {
  label: string;
  fast: string;
  slow: string;
  slowExpect: string;
  opts?: { decodeSlashes?: boolean };
}

const PAIRS: Pair[] = [
  {
    // Literal `..` that actually resolves. `bb` <-> `..`.
    label: "literal .. traversal",
    fast: "/x/aa/bb/cc/dd/ee/ff",
    slow: "/x/aa/../cc/dd/ee/ff",
    slowExpect: "/x/cc/dd/ee/ff",
  },
  {
    // Percent-encoded dot segment. `xxxxxx` <-> `%2e%2e`.
    label: "encoded %2e%2e traversal",
    fast: "/x/aa/xxxxxx/cc/dd/ee",
    slow: "/x/aa/%2e%2e/cc/dd/ee",
    slowExpect: "/x/cc/dd/ee",
  },
  {
    // Backslash normalization. `/` <-> `\` after the root.
    label: "backslash normalization",
    fast: "/a/b/c/d/e/f/g",
    slow: "/a\\b\\c\\d\\e\\f\\g",
    slowExpect: "/a/b/c/d/e/f/g",
  },
  {
    // Opt-in encoded separator. `userxxxprofile` <-> `user%2fprofile`.
    label: "decodeSlashes: single %2f",
    fast: "/x/aa/userxxxprofile/cc",
    slow: "/x/aa/user%2fprofile/cc",
    slowExpect: "/x/aa/user/profile/cc",
    opts: { decodeSlashes: true },
  },
  {
    // Nested encoded separator (the multi-decode hardening).
    // `userxxxxxprofile` <-> `user%252fprofile`.
    label: "decodeSlashes: nested %252f",
    fast: "/x/aa/userxxxxxprofile/cc",
    slow: "/x/aa/user%252fprofile/cc",
    slowExpect: "/x/aa/user/profile/cc",
    opts: { decodeSlashes: true },
  },
];

// Realistic serveStatic-shaped inputs — absolute-cost reference. Most real
// assets contain a segment-internal `.`, so this shows the boundary-aware guard
// keeping them on the fast path while genuine traversal still resolves.
const REALISTIC = [
  "/index.html",
  "/assets/app.4f3a2b1c.js",
  "/assets/chunks/vendor.8e1d.css",
  "/api/../secret",
  "/images/logo.svg",
];

// --- Correctness + fairness guards (fail loud before benching) ---
for (const p of FAST_PATH) {
  const out = resolveDotSegments(p);
  if (out !== p) {
    throw new Error(`fast-path input took the slow path or changed: ${p} -> ${out}`);
  }
}
for (const p of PAIRS) {
  if (p.fast.length !== p.slow.length) {
    throw new Error(`unfair pair "${p.label}": fast(${p.fast.length}) !== slow(${p.slow.length})`);
  }
  const fastOut = resolveDotSegments(p.fast, p.opts);
  if (fastOut !== p.fast) {
    throw new Error(`"${p.label}" fast input is not on the fast path: ${p.fast} -> ${fastOut}`);
  }
  const slowOut = resolveDotSegments(p.slow, p.opts);
  if (slowOut !== p.slowExpect) {
    throw new Error(`"${p.label}" slow output ${slowOut} !== expected ${p.slowExpect}`);
  }
}

compact(() => {
  // All fast-path inputs should land within a hair of each other (any spread is
  // string length, not path selection) — the boundary-aware guard's payoff.
  summary(() => {
    for (const path of FAST_PATH) {
      bench(`fast: ${path}`, () => do_not_optimize(resolveDotSegments(path))).gc("once");
    }
  });

  for (const p of PAIRS) {
    summary(() => {
      bench(`fast: ${p.label}`, () => do_not_optimize(resolveDotSegments(p.fast, p.opts))).gc(
        "once",
      );
      bench(`slow: ${p.label}`, () => do_not_optimize(resolveDotSegments(p.slow, p.opts))).gc(
        "once",
      );
    });
  }

  summary(() => {
    for (const path of REALISTIC) {
      bench(`realistic: ${path}`, () => do_not_optimize(resolveDotSegments(path))).gc("once");
    }
  });
});

await run({ throw: true });
