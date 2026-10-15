# Vendored bgc-viewer assets

These files are copied verbatim from `@kretep/bgc-viewer-components`
(`dist/web-components/`) so the client can fetch them at runtime:

- `style.css` — injected into the web component's **shadow root** (the global
  stylesheet cannot cross the shadow boundary, so gene/domain colors would be
  missing without this).
- `domain-colors.csv` — parsed into the `pfamColorMap` for PFAM domain coloring.

**Refresh on version bump:** after changing the `@kretep/bgc-viewer-components`
version in `package.json`, run `npm run sync:bgc-viewer-assets`.
