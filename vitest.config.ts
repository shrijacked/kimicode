import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@kimicode/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@kimicode/provider-moonshot": fileURLToPath(new URL("./packages/provider-moonshot/src/index.ts", import.meta.url)),
      "@kimicode/tools": fileURLToPath(new URL("./packages/tools/src/index.ts", import.meta.url)),
      "@kimicode/skills-starter": fileURLToPath(new URL("./packages/skills-starter/src/index.ts", import.meta.url)),
      "@kimicode/testkit": fileURLToPath(new URL("./packages/testkit/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
      include: ["packages/**/src/**/*.ts", "apps/**/src/**/*.ts", "apps/**/src/**/*.tsx"]
    }
  }
});
