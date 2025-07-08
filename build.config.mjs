import { defineBuildConfig } from "obuild/config";

const { exports } = await import("./package.json", { with: { type: "json" } });

export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: [...inferExports(exports)],
    },
  ],
  hooks: {
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
