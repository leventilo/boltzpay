import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["@coinbase/cdp-sdk", "@solana/kit", "@x402/core", "@x402/evm", "@x402/fetch", "@x402/svm"],
});
