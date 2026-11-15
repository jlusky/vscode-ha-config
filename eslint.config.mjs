// eslint.config.mjs
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import stylistic from "@stylistic/eslint-plugin";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default tseslint.config(
  // Global ignores: build output, dependencies, test downloads and Claude Code worktrees
  {
    ignores: [
      "**/node_modules/**",
      "**/out/**",
      "**/dist/**",
      "**/.vscode-test/**",
      ".claude/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  prettierConfig,
  {
    plugins: {
      "@stylistic": stylistic
    },
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      parserOptions: {
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // Base rules
      "curly": "warn",
      
      // TypeScript rules
      "@typescript-eslint/no-explicit-any": 0,
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/consistent-indexed-object-style": 0, // Allow index signatures
      
      // Stylistic rules
      "@stylistic/semi": ["warn", "always"],
      "@stylistic/quotes": ["warn", "double"],
      "@stylistic/indent": ["warn", 2],
    },
  },
);
