import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    // *.db.test.ts files run against MariaDB when TEST_DATABASE_URL is set.
    fileParallelism: false,
    environment: "node",
  },
});
