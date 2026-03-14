<!-- NOTE: Keep this file updated as the project evolves. When making architectural changes, adding new patterns, or discovering important conventions, update the relevant sections. -->

# H3 - Agent Guide

H3 (pronounced /eɪtʃθriː/) is a minimal HTTP framework built for high performance and portability. Currently on **v2** — a major rewrite based on **web standard primitives** (Request, Response, URL, Headers).

## Quick Reference

```bash
# Setup
corepack enable && pnpm install

# Development
pnpm dev                    # vitest watch mode
pnpm vitest run <path>      # run specific test
pnpm test                   # full suite (lint + typecheck + coverage)
pnpm build                  # build with obuild
pnpm lint                   # oxlint + oxfmt --check
pnpm fmt                    # automd + oxlint --fix + oxfmt
pnpm typecheck              # tsgo --noEmit --skipLibCheck
pnpm bench:node             # node benchmarks
pnpm bench:bun              # bun benchmarks
```

## Architecture

### Core Design

- **Web standards first**: Built on native `Request`, `Response`, `URL`, `Headers`
- **Multi-runtime**: Node.js, Bun, Deno, Cloudflare Workers, Service Workers, browsers
- **Minimal core**: 2 production deps (`rou3` for routing, `srvx` for server abstraction)
- **Handler-based**: Composable handlers + middleware, no class-heavy patterns
- **Type-safe**: Strict TypeScript with generic inference throughout

### Key Classes

| Class          | File              | Purpose                                                                           |
| -------------- | ----------------- | --------------------------------------------------------------------------------- |
| `H3`           | `src/h3.ts`       | Main app class (extends `H3Core`), adds routing methods (get/post/put/delete/...) |
| `H3Event`      | `src/event.ts`    | Request wrapper — wraps web `Request` with lazy properties (URL, context)         |
| `HTTPError`    | `src/error.ts`    | Structured HTTP error with status, data, headers                                  |
| `HTTPResponse` | `src/response.ts` | Flexible response builder                                                         |

### Request Flow

1. Request enters via platform adapter (`src/_entries/*.ts`)
2. `H3.fetch()` creates `H3Event` from `Request`
3. Global `onRequest` hooks run
4. Middleware chain executes (matched by route/method)
5. Route handler processes request, returns a value
6. `toResponse()` converts return value → `Response` (auto-handles JSON, streams, blobs, primitives)
7. Global `onResponse` hooks run

## Project Structure

```
src/
├── index.ts              # Public API exports
├── h3.ts                 # H3Core + H3 classes
├── event.ts              # H3Event
├── handler.ts            # defineHandler, defineValidatedHandler, etc.
├── middleware.ts          # Middleware system
├── response.ts           # toResponse, HTTPResponse, kNotFound, kHandled
├── error.ts              # HTTPError
├── adapters.ts           # Web/Node handler adapters
├── tracing.ts            # Tracing plugin (separate entry point)
├── types/                # Type definitions
│   ├── h3.ts             # App types (H3Config, H3Plugin, H3Route, HTTPMethod)
│   ├── handler.ts        # Handler types (EventHandler, Middleware)
│   ├── context.ts        # H3EventContext
│   └── _utils.ts         # Internal type helpers
├── utils/                # ~30 utility modules (public API)
│   ├── request.ts        # getQuery, getRouterParams, getRequestURL, ...
│   ├── response.ts       # redirect, noContent, html, iterable, ...
│   ├── body.ts           # readBody, readValidatedBody, assertBodySize
│   ├── cookie.ts         # getCookie, setCookie, parseCookies, chunked cookies
│   ├── session.ts        # getSession, useSession, sealSession, ...
│   ├── auth.ts           # requireBasicAuth, basicAuth
│   ├── cors.ts           # handleCors, appendCorsHeaders, ...
│   ├── proxy.ts          # proxy, proxyRequest, fetchWithEvent
│   ├── ws.ts             # defineWebSocketHandler, defineWebSocket
│   ├── json-rpc.ts       # defineJsonRpcHandler, defineJsonRpcWebSocketHandler
│   ├── event-stream.ts   # createEventStream (SSE)
│   ├── static.ts         # serveStatic
│   ├── cache.ts          # handleCacheHeaders
│   ├── middleware.ts      # onRequest, onResponse, onError, bodyLimit
│   ├── route.ts          # defineRoute
│   ├── base.ts           # withBase
│   └── internal/         # Internal helpers (not exported)
│       ├── auth.ts, body.ts, cors.ts, encoding.ts, ...
│       ├── iron-crypto.ts    # Session sealing crypto
│       ├── standard-schema.ts # Standard schema validation
│       └── validate.ts
├── _entries/             # Platform-specific entry points
│   ├── generic.ts        # Web Worker / Browser
│   ├── node.ts           # Node.js (adds serve())
│   ├── bun.ts            # Bun
│   ├── deno.ts           # Deno
│   ├── cloudflare.ts     # Cloudflare Workers
│   ├── service-worker.ts # Service Workers
│   └── _common.ts        # Shared entry utilities
└── _deprecated.ts        # Deprecated exports (v1 compat)

test/
├── _setup.ts             # Test infrastructure (describeMatrix, setupWebTest, setupNodeTest)
├── *.test.ts             # ~30 integration test files
├── unit/                 # Unit tests (including type tests: types.test-d.ts)
├── bench/                # Benchmarks (mitata)
└── fixture/              # Runtime-specific playground fixtures
```

## Code Conventions

### Style

- **ESM only** — no CommonJS
- **Explicit `.ts` extensions** in all import paths
- **No barrel files** — import directly from specific modules
- **Internal files** use `_` prefix (e.g., `_deprecated.ts`, `_entries/`, `_utils.ts`)
- **Internal helpers** go at the end of files or in `utils/internal/`
- **Short files** — aim for < 200 LoC per file, split when larger
- **Options object** as second param for multi-arg functions
- Formatting: `oxfmt` (no config, uses defaults)
- Linting: `oxlint` with `unicorn`, `typescript`, `oxc` plugins

### Naming

- `k` prefix for symbol constants (`kNotFound`, `kHandled`)
- `~` prefix for private/non-enumerable properties
- `#` for truly private class fields
- `define*()` for factory functions (`defineHandler`, `defineMiddleware`, `defineWebSocketHandler`)
- `to*()` for conversion functions (`toResponse`, `toEventHandler`, `toWebHandler`)
- `from*()` for adapter functions (`fromWebHandler`, `fromNodeHandler`)

### TypeScript

- Strict mode + `isolatedDeclarations` + `verbatimModuleSyntax`
- `erasableSyntaxOnly: true` (no enums, no namespaces)
- Target/module: `ESNext` / `NodeNext`
- Lib: `["ESNext", "WebWorker", "DOM", "DOM.Iterable"]`
- Heavy use of generics for type inference in handlers

### Response Handling

Handlers return values directly — no `res.send()` pattern:

- Return `string` → text response
- Return `object` → JSON response
- Return `Response` / `HTTPResponse` → direct response
- Return `ReadableStream` / `Blob` / `File` → streamed response
- Return `kNotFound` symbol → 404
- Return `kHandled` symbol → already handled (SSE, WebSocket, etc.)

## Testing

### Framework

- **Vitest** v4+ with **v8** coverage
- Matrix testing: every test runs in both `web` and `node` modes

### Writing Tests

```typescript
import { describeMatrix } from "./_setup.ts";

describeMatrix("feature name", (ctx, { it, expect }) => {
  it("does something", async () => {
    ctx.app.get("/test", () => "hello");
    const res = await ctx.fetch("/test");
    expect(await res.text()).toBe("hello");
  });
});
```

Key patterns:

- Use `describeMatrix` for cross-runtime tests
- `ctx.app` is a fresh `H3` instance per test (via `beforeEach`)
- `ctx.fetch` handles URL resolution for both web/node
- `ctx.errors` tracks unhandled errors (auto-asserted in `afterEach`)
- Use `it.skipIf(ctx.target === "node")` for runtime-specific skips

### Running Tests

```bash
pnpm vitest run test/body.test.ts        # single file
pnpm vitest run test/unit/               # unit tests
pnpm dev                                 # watch mode (all)
pnpm test                                # full: lint + typecheck + coverage
```

### Bug Fix Workflow

1. Write regression test that reproduces the bug
2. Confirm test **fails** before any code changes
3. Fix the implementation (minimal change)
4. Confirm test **passes**
5. Run broader test suite for regressions

## Build

- **obuild** with Rolldown bundler
- 6 platform entries + `tracing.ts` as separate entry
- Code splitting enabled (`h3-[hash].mjs` chunks)
- Custom plugin strips comments (preserves `#/@` annotations)
- Output: `dist/_entries/*.mjs` + `dist/*.d.mts`

### Package Exports

```
h3           → auto-resolved by runtime (deno/bun/workerd/node/default)
h3/node      → Node.js with serve()
h3/bun       → Bun runtime
h3/deno      → Deno runtime
h3/cloudflare → Cloudflare Workers
h3/service-worker → Service Workers
h3/generic   → Universal web standard
h3/tracing   → Tracing plugin
```

## Dependencies

| Dep       | Purpose                                   |
| --------- | ----------------------------------------- |
| `rou3`    | Route matching engine                     |
| `srvx`    | Server abstraction (multi-runtime)        |
| `crossws` | WebSocket abstraction (optional peer dep) |

## How to Contribute (PR Philosophy)

This project has a high quality bar. Understanding the maintainer's expectations before writing code prevents wasted effort and rejected PRs.

### 1. Understand before you touch

Before changing any code, deeply understand **why** the existing code is written the way it is. h3 makes deliberate trade-offs that may look "wrong" at first glance but exist for specific reasons:

- `iterations: 1` in iron-crypto looks insecure but is intentional — it relies on 32-char minimum password entropy instead of iteration count, because session sealing runs on every request (not at login like password hashing)
- The middleware chain avoids `async/await` everywhere — not by accident, but because `async` forces a microtask Promise allocation even when the underlying work is synchronous
- `.catch()` with no callback in EventStream looks like a mistake but is intentional error suppression for closed streams

**Before proposing a fix**: Read the surrounding code, check git blame for context, search issues for prior discussion. If something looks wrong, it might be a deliberate design decision.

### 2. Prove it with tests first

Every code change requires a regression test. The test must:

1. **Fail** on the original code (without your fix)
2. **Pass** with your fix applied

```bash
# Verify your test is a true regression test:
# 1. Write the test, commit with your fix
# 2. Temporarily restore original code — test must FAIL
git show main:src/file.ts > /tmp/original.ts
cp src/file.ts /tmp/fixed.ts
cp /tmp/original.ts src/file.ts
pnpm vitest run test/file.test.ts  # must FAIL
# 3. Restore fix — test must PASS
cp /tmp/fixed.ts src/file.ts
pnpm vitest run test/file.test.ts  # must PASS
```

A PR with code changes but no tests will be asked to add them. A PR with tests that pass on both old and new code proves nothing.

### 3. Performance is not optional

h3 is a minimal HTTP framework where every microsecond in the hot path matters. The middleware dispatch chain (`h3.ts` handler/mount, `middleware.ts` callMiddleware, `response.ts` toResponse) runs on **every single request**.

**Critical rules for the hot path**:

- **Never use `async/await`** — it forces a Promise allocation even for synchronous code paths. Use the duck-type check pattern instead:

```typescript
// ✅ Stays sync when possible
const result = callMiddleware(event, middleware, handler);
if (typeof (result as PromiseLike<unknown>)?.then === "function") {
  return (result as Promise<unknown>).then(onSuccess, onError);
}
return result;

// ❌ Forces Promise allocation on every call
return await callMiddleware(event, middleware, handler);
```

- **`async/await` is fine** in user-facing utilities (`withBase`, `readBody`, `useSession`, etc.) — these are not in the per-request dispatch path or the user has already entered async territory.

- **Bundle size is enforced** via `test/bench/bundle.test.ts`. If your change increases the bundle, you must justify the added bytes and update the limits.

### 4. Research claims before making them

If you cite a security standard, performance number, or spec requirement — verify it independently. Don't rely on what an issue reporter claims without checking primary sources.

Example: An issue cited "OWASP recommends 600,000 PBKDF2 iterations" — but h3 uses SHA-1 for PBKDF2, and the actual OWASP recommendation for SHA-1 is 1,300,000 (600,000 is for SHA-256). Getting this wrong in a security PR erodes trust.

### 5. Keep changes minimal

- One fix per PR. Don't bundle unrelated improvements.
- Don't refactor code you didn't need to change for the fix.
- Every added byte to the bundle needs justification.
- If you need to increase a bundle size limit, explain why the added code is necessary.

## Best Practices for Contributing

- Prefer web standard APIs over runtime-specific ones
- Keep the core minimal — add utilities, not core complexity
- Test across runtimes using `describeMatrix`
- Return values from handlers instead of mutating responses
- Use `defineHandler`/`defineMiddleware` for type safety
