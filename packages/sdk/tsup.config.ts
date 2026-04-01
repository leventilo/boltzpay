import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // @coinbase/cdp-sdk is loaded lazily via dynamic require() at runtime.
  // mppx is an optional peer dependency for MCP payment wrapping.
  // Mark both external so esbuild does not attempt to bundle them.
  external: ["@coinbase/cdp-sdk", "mppx", "mppx/mcp-sdk/client"],
});
