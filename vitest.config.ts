import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@ovxa/schema": fromRoot("./packages/schema/src/index.ts"),
      "@ovxa/registry": fromRoot("./packages/registry/src/index.ts"),
      "@ovxa/intelligence": fromRoot("./packages/intelligence/src/index.ts"),
      "@ovxa/compiler": fromRoot("./packages/compiler/src/index.ts"),
      "@ovxa/protocol": fromRoot("./packages/protocol/src/index.ts"),
      "@ovxa/genui-runtime": fromRoot("./packages/genui-runtime/src/index.ts"),
      "@ovxa/streaming": fromRoot("./packages/streaming/src/index.ts"),
      "@ovxa/wire": fromRoot("./packages/wire/src/index.ts"),
      "@ovxa/llm": fromRoot("./packages/llm/src/index.ts"),
      "@ovxa/surface-kit": fromRoot("./packages/surface-kit/src/index.ts"),
      "@ovxa/surface-model": fromRoot("./packages/surface-model/src/index.ts"),
      "@ovxa/react": fromRoot("./packages/react/src/index.tsx"),
      "@ovxa/client": fromRoot("./packages/client/src/index.ts"),
      "@ovxa/sdk": fromRoot("./packages/sdk/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "packages/**/*.test.tsx"],
    environment: "happy-dom",
  },
});
