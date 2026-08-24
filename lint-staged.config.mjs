export default {
  "*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}": ["prettier --write", "eslint --fix"],
  "*.{json,jsonc,css,md,yml,yaml}": "prettier --write --ignore-unknown",
};
