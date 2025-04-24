import unjs from 'eslint-config-unjs';

export default unjs(
  {
    ignores: [
      "**/.nuxt",
      "**/.output"
    ]
  },
  {
    rules: {
      "unicorn/no-null": "off",
      "unicorn/number-literal-case": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "unicorn/expiring-todo-comments": "off",
      "unicorn/no-nested-ternary": "off",
    }
  }
);
