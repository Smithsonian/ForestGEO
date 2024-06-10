module.exports = {
  parser: "@typescript-eslint/parser",
  extends: ["next", "plugin:@typescript-eslint/recommended"],
  settings: {
    next: {
      rootDir: "."
    }
  },
  plugins: ["@typescript-eslint", "unused-imports"],
  rules: {
    "react-hooks/exhaustive-deps": "off",
    "semi": ["error", "always"],
    "unused-imports/no-unused-imports": "error",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "unused-imports/no-unused-vars": "off"
  }
};