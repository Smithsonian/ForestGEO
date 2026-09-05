# Hydration mismatch investigation — July 2026

The original walkthrough reported a hydration mismatch but did not preserve the browser warning, route, component stack, authentication state, or selection state. Because Tasks 13–26 had already been changed before this audit began, the plan's requested "before any fix" evidence cannot be reconstructed honestly.

## Reproduction protocol and evidence

1. Start the production build (`npm run build && npm run start`).
2. Open `/login` at 390 px and capture the browser console from navigation through the first settled render.
3. Sign in, open `/dashboard`, reload once with no selection and once with a persisted site/plot/census selection.
4. Open and close the mobile navigation Drawer on each route.
5. Search the captured console for `Hydration failed`, `hydration mismatch`, and `server rendered HTML`.

Result from the remediation verification on 2026-07-10: a production build completed successfully. At a 390 × 844 viewport, `/login` loaded with no browser console warnings or errors; an unauthenticated `/dashboard` navigation redirected to `/login` with no browser console warnings or errors. The local session endpoint did not settle past the app's `Loading...` state, so authenticated dashboard and persisted-selection cases could not be exercised in this environment. The unit suite's direct render of `NewValidationRow` does emit a `<tr>`-under-`<div>` hydration warning, but that is a test-harness artifact: the production component is rendered under a table body. This is limited negative evidence, not proof that the historical report was incorrect.

The mobile navigation now uses React-owned Joy Drawer state. The former `--SideNavigation-slideIn` document-style mutation has been removed. If the warning recurs, append the complete console message and component stack here before changing the implicated component.
