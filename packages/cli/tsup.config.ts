import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: [
    "@boltzpay/sdk",
    "@coinbase/cdp-sdk",
    "@getalby/sdk",
    "light-bolt11-decoder",
    "commander",
    "chalk",
    "dotenv",
    "zod",
  ],
});
