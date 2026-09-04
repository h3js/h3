import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    typecheck: {
      enabled: !process.argv.includes("bench"),
      // `test/rules/*.test-d.ts` are flat assertion sheets: module augmentation
      // and ambient declarations cannot nest inside a test, so they declare no
      // suite — and vitest v5 fails any `.test-d.ts` file with zero tests.
      // `pnpm typecheck` (tsc over `src` + `test`) already validates them.
      exclude: [...configDefaults.typecheck.exclude, "test/rules/*.test-d.ts"],
    },
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/types/**", "src/_deprecated.ts", "src/_entries/**"],
    },
  },
});
