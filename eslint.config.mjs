import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Generated framework, deployment, and local test artifacts:
    ".next/**",
    ".vinext/**",
    ".wrangler/**",
    "dist/**",
    "out/**",
    "outputs/**",
    "work/**",
    "coverage/**",
    "**/.pytest_cache/**",
    "**/__pycache__/**",
    "services/agent/.venv/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
