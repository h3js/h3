import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// Published `dist/*.d.mts` is what a downstream `tsc --skipLibCheck false` checks.
// Source tests never see `static override isError` or the optional `crossws` import.
// https://github.com/h3js/h3/issues/1657

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(repoRoot, "dist");
const tsc = join(repoRoot, "node_modules/typescript/bin/tsc");

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path);
}

function typecheck(options: { lib: "ES2022" | "ESNext"; crossws: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), "h3-dts-"));
  roots.push(root);
  // Copy dist. A symlink is realpath'd by tsc back into this repo, which still
  // has the optional peer installed, so the missing-module error would never show.
  link(join(repoRoot, "package.json"), join(root, "node_modules/h3/package.json"));
  cpSync(distDir, join(root, "node_modules/h3/dist"), { recursive: true });
  link(join(repoRoot, "node_modules/srvx"), join(root, "node_modules/srvx"));
  link(join(repoRoot, "node_modules/@types/node"), join(root, "node_modules/@types/node"));
  if (options.crossws) {
    link(join(repoRoot, "node_modules/crossws"), join(root, "node_modules/crossws"));
  }

  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: options.lib,
          // h3's declarations use DOM types (HeadersInit, BodyInit). ES2022 / ESNext alone do not include them.
          lib: [options.lib, "DOM"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noImplicitOverride: true,
          skipLibCheck: false,
          noEmit: true,
          types: ["node"],
        },
        files: options.crossws ? ["index.ts", "crossws-compat.ts"] : ["index.ts"],
      },
      null,
      2,
    ),
  );

  // The reported program: importing h3 must not require ESNext or crossws.
  writeFileSync(
    join(root, "index.ts"),
    `
import { H3, HTTPError, type H3Event } from "h3";

export const app = new H3().get("/", (event: H3Event) => event.url.pathname);

declare const value: unknown;
export const status = HTTPError.isError(value) ? value.status : 0;
`,
  );

  if (options.crossws) {
    // Installed crossws must stay the same nominal types h3 re-exports.
    writeFileSync(
      join(root, "crossws-compat.ts"),
      `
import type { Hooks, Peer } from "crossws";
import {
  defineJsonRpcWebSocketHandler,
  defineWebSocketHandler,
  type WebSocketHooks,
  type WebSocketPeer,
} from "h3";

declare const hooks: Hooks;
defineWebSocketHandler(hooks);

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const hooksMatch: Equal<WebSocketHooks, Hooks> = true;
const peersMatch: Equal<WebSocketPeer, Peer> = true;

declare const peer: WebSocketPeer;
peer.publish("room", "hello");
const buffered: number = peer.bufferedAmount;

const method = (_data: unknown, socket: Peer) => {
  socket.send("ok");
};
defineJsonRpcWebSocketHandler({ methods: { ping: method } });

void hooksMatch;
void peersMatch;
void buffered;
`,
    );
  }

  const result = spawnSync(tsc, ["--pretty", "false", "-p", root], {
    encoding: "utf8",
    cwd: root,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  expect(result.error).toBeUndefined();
  expect(
    result.status,
    output || `tsc exited with status ${result.status} (signal ${result.signal})`,
  ).toBe(0);
  return output;
}

describe.skipIf(!existsSync(distDir) || !existsSync(tsc))(
  "downstream tsc without skipLibCheck",
  () => {
    for (const lib of ["ES2022", "ESNext"] as const) {
      for (const crossws of [false, true]) {
        it(`typechecks with lib ${lib}${crossws ? " and crossws" : ""}`, () => {
          const output = typecheck({ lib, crossws });
          expect(output, output).toBe("");
        }, 60_000);
      }
    }
  },
);
