import { defineConfig } from "vitest/config";

// Only run the TypeScript sources under src. Without this, a prior `tsc` build
// leaves compiled copies in dist/__tests__, which vitest would otherwise pick up
// and run a second time.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
