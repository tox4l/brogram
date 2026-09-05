import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "brogram-scaffold/**",
    ".a0-artifacts/**",
    "UDST START*/**",
    "docs/research/raw-condensed.txt",
    "docs/research/review-findings.txt",
    "docs/research/condense-review.mjs",
  ]),
]);

export default eslintConfig;
