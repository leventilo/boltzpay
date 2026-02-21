export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 72],
    "scope-enum": [
      2,
      "always",
      ["core", "protocols", "sdk", "mcp", "cli", "landing", "build"],
    ],
    "scope-empty": [1, "never"],
    "subject-case": [2, "always", "lower-case"],
  },
};
