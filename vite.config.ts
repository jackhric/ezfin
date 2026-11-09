import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    // Vendored shadcn components are generated code; do not lint them.
    ignorePatterns: ["apps/web/src/components/ui/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
