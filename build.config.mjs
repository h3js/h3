import { defineBuildConfig } from "obuild/config";
import { parseSync } from "oxc-parser";
import MagicString from "magic-string";

const { exports } = await import("./package.json", { with: { type: "json" } });

export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: [...inferExports(exports)],
    },
  ],
  hooks: {
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
    rolldownOutput(outConcig) {
      outConcig.chunkFileNames = "h3.mjs";
    },
  },
});

function inferExports(exports) {
  const entries = new Set();
  for (const value of Object.values(exports)) {
    if (typeof value === "string") {
      if (value.endsWith(".mjs")) {
        entries.add(value.replace("./dist", "./src").replace(".mjs", ".ts"));
      }
    } else if (typeof value === "object" && value !== null) {
      entries.add(...inferExports(value));
    }
  }
  return entries;
}
