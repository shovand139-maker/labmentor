import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // Next.js enforces server-only imports at build time; tests run outside Next.
  "server-only": fileURLToPath(
    new URL("./tests/stubs/server-only.ts", import.meta.url),
  ),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          // One database, many tests: run files one at a time so fixtures do not race.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
