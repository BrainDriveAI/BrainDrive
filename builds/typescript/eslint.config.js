import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "client_web/**",
      "dist/**",
      "node_modules/**",
      "src-tauri/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
);
