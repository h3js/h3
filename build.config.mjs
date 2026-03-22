import { defineBuildConfig } from "obuild/config";
import { parseSync } from "oxc-parser";
import MagicString from "magic-string";
import { mkdir, rmdir } from "node:fs/promises";

const entries = ["deno", "bun", "cloudflare", "service-worker", "node", "generic"];

export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: [...entries.map((entry) => `src/_entries/${entry}.ts`), "./src/tracing.ts"],
    },
  ],
  hooks: {
    rolldownOutput(config) {
      config.codeSplitting = {};
      config.chunkFileNames = "h3-[hash].mjs";
    },
    async end() {
      const { DocsManager, DocsSourceFS, exportDocsToFS } = await import("mdzilla");
      const man = new DocsManager(new DocsSourceFS("./docs"));
      await man.load();
      await mkdir("./dist/docs", { recursive: true });
      await exportDocsToFS(man, "./dist/docs", {
        title: "H3 Documentation",
        tocFile: "TOC.md",
        filter: (e) => !e.entry.path.startsWith("/blog"),
      });
    },
    rolldownConfig(config) {
      config.experimental ??= {};
      config.experimental.attachDebugInfo = "none";

      config.plugins ??= [];
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
  },
});
