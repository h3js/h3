import { bench, summary, compact, do_not_optimize, run } from "mitata";
import { resolveDotSegments } from "../../src/utils/path.ts";

// Micro-benchmarks for `resolveDotSegments`, focused on the fast-path vs
// slow-path overhead.
//
// Fairness: every fast/slow pair below is byte-for-byte the SAME length and
// segment count, and differs only in the character(s) that flip the fast-path
// guard — a `.`, a `%`, or a `\`. So each summary's relative multiplier is the
// pure cost of taking the slow path (split → per-segment normalize → join)
// relative to the early-return fast path, not a string-length or segment-count
// artifact. The `fast:` case is the floor (guard scans + early return); results
// are fed to `do_not_optimize` so nothing is eliminated as dead code.

interface Pair {
  label: string;
  /** Fast-path input: hits the early return. */
  fast: string;
  /** Slow-path input: same length/shape, one char class flipped. */
  slow: string;
  /** Expected `resolveDotSegments(slow, opts)` output (correctness guard). */
  slowExpect: string;
  opts?: { decodeSlashes?: boolean };
}

// Each pair's `fast`/`slow` are equal length; the flipped chars are noted.
const PAIRS: Pair[] = [
  {
    // The TODO(perf) case: a dotted asset filename has a `.` but no real dot
    // segment, so it is pushed onto the slow path for nothing. `.` <-> `x`.
    label: "dotted filename (no real segment)",
    fast: "/assets/app/f4a2b1c8/mainxjs",
    slow: "/assets/app/f4a2b1c8/main.js",
    slowExpect: "/assets/app/f4a2b1c8/main.js",
  },
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

// --- Correctness + fairness guards (fail loud before benching) ---
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

// Realistic serveStatic-shaped inputs — absolute-cost reference, not matched
// pairs. Shows the mix a static server actually sees (most real assets contain
// a `.`, so they currently take the slow path — see the TODO(perf)).
const REALISTIC = [
  "/index.html",
  "/assets/app.4f3a2b1c.js",
  "/assets/chunks/vendor.8e1d.css",
  "/api/../secret",
  "/images/logo.svg",
];

compact(() => {
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
