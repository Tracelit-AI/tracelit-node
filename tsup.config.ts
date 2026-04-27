import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "node18",
  platform: "node",
  // Both CJS and ESM bundles include default + named exports.
  // "named" mode exposes `module.exports.default = Tracelit` for CJS consumers
  // so `require("tracelit").default` works, while named exports are on the
  // module root. ESM consumers use `import Tracelit from "tracelit"` as normal.
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
});
