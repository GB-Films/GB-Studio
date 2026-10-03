# GB Studio release versions

- `versions.json` is the source of truth for the Visto (`visto`) and Mira (`mira`) version labels shown on the home cards.
- Before publishing a user-facing feature, behavior, or interface update to Visto or Mira, increment that tool's version in `versions.json`. Keep the other tool's version unchanged.
- Follow semantic versioning: patch for fixes, minor for backward-compatible features, major for incompatible changes. The initial displayed version for each tool is `1.0.0`.
- Do not bump these versions for documentation, deployment, or unrelated GB Studio changes that do not update Visto or Mira.
- Keep the fallback labels in `index.html` in sync with `versions.json` and cache-bust `auth.js` when changing the loader.
