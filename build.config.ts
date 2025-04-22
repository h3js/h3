import { rm } from "node:fs/promises";
import type { BuildConfig } from "unbuild";

const config: BuildConfig = {
  declaration: true,
  rollup: {
    esbuild: {
      target: "ES2022",
      tsconfigRaw: {
        compilerOptions: {
          useDefineForClassFields: false,
        },
      },
    },
  },
  hooks: {
    async "build:done"() {
      await rm("dist/index.d.ts");
    },
  },
};

export default config;
