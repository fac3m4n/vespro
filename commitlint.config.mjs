/**
 * Conventional Commits, checked on demand rather than through a git hook:
 *   npm run commit        guided prompt (commitizen)
 *   npm run lint:commit   check the last commit
 *   npm run lint:commits  check everything on this branch
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // The scopes actually present in this repo. Left open-ended deliberately — an
    // unlisted scope is a warning, not a failed commit.
    "scope-enum": [
      1,
      "always",
      ["arkiv", "swarm", "fuji", "ui", "api", "crypto", "docs", "deps", "scripts"],
    ],
    "body-max-line-length": [1, "always", 100],
  },
};
