import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    typecheck: { enabled: !process.argv.includes("bench") },
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/types/**", "src/_deprecated.ts", "src/_entries/**"],
    },
  },
});
