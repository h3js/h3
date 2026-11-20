import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineBuildConfig } from "obuild/config";
import { parseSync } from "oxc-parser";
import MagicString from "magic-string";

const entries = ["deno", "bun", "cloudflare", "service-worker", "node", "generic"];

export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: [
        ...entries.map((entry) => `src/_entries/${entry}.ts`),
        "./src/tracing.ts",
        "./src/rules/index.ts",
        "./src/rules/cache.ts",
        "./src/rules/proxy.ts",
        "./src/rules/compiler.ts",
      ],
    },
  ],
  hooks: {
    rolldownOutput(config) {
      config.codeSplitting = {};
      config.chunkFileNames = (chunkInfo) => {
        if (chunkInfo.name === "src") {
          return "h3.mjs";
        }
        return "[name].mjs";
      };
    },
    rolldownConfig(config) {
      config.experimental ??= {};
      config.experimental.attachDebugInfo = "none";
      if (!Array.isArray(config.plugins)) {
        config.plugins = [];
      }
      config.plugins.push({
        name: "remove-comments",
        renderChunk(code) {
          const parsed = parseSync("index.js", code);
          if (parsed.comments.length === 0) {
            return;
          }
          const ms = new MagicString(code);
          for (const comment of parsed.comments) {
            if (/^\s*[#@]/.test(comment.value)) {
              continue;
            }
            ms.remove(comment.start, comment.end);
          }
          return ms.toString();
        },
      });
    },
    async end(ctx) {
      // Declaration emit is what `tsc --skipLibCheck false` checks.
      // Source keeps `override` (this repo's lib is ESNext + noImplicitOverride).
      // Published .d.mts must not: `Error.isError` is ESNext-only, so ES2022 reports TS4113.
      // `crossws` stays an optional peer. Ignoring only that import keeps the real,
      // nominal types when it is installed and does not fail resolution when it is not.
      await patchDeclarationTree(join(ctx.pkgDir, "dist"));
    },
  },
});

const crosswsSpecifier = /^(import|export)[^\n]*\sfrom\s+["']crossws(?:\/[^"']*)?["'];?\s*$/gm;

function patchPublishedDeclarations(source: string): string {
  const withoutLibOverride = source.replaceAll("static override isError", "static isError");
  return withoutLibOverride.replace(crosswsSpecifier, (statement, _kind, offset, full) => {
    const lineStart = full.lastIndexOf("\n", offset - 1) + 1;
    if (lineStart === 0) {
      return `// @ts-ignore optional peer dependency\n${statement}`;
    }
    const previousBreak = full.lastIndexOf("\n", lineStart - 2);
    const previousLine = full.slice(previousBreak + 1, lineStart - 1);
    if (previousLine.includes("@ts-ignore")) {
      return statement;
    }
    return `// @ts-ignore optional peer dependency\n${statement}`;
  });
}

async function patchDeclarationTree(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await patchDeclarationTree(path);
        return;
      }
      if (!entry.name.endsWith(".d.mts")) {
        return;
      }
      const source = await readFile(path, "utf8");
      const patched = patchPublishedDeclarations(source);
      if (patched !== source) {
        await writeFile(path, patched);
      }
    }),
  );
}
