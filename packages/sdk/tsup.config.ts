import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // @coinbase/cdp-sdk is loaded lazily via dynamic require() at runtime.
  // Mark it external so esbuild does not attempt to bundle it.
  external: ["@coinbase/cdp-sdk"],
});
