# Preview startup repair — 2026-11-09

- [x] Investigate the build and restore missing project files and dependencies from the saved GitHub revision without losing the incomplete sandbox snapshot.
- [x] Fix startup failures so the game preview remains available even when the optional account API is unavailable. Verified with a real API connection failure: the game listener still returns HTTP 200.
- [x] Surface browser/engine startup failures rather than leaving the loading screen indefinitely. Verified with WebGL disabled: actionable message and reload button, no unhandled rejection.
- [ ] Synchronize rotated managed database credentials when project recovery tooling is available; restart the affected development services with their original start commands. Blocked: managed workspace recovery tooling is unavailable and project runtime variables have not been injected; account functions are temporarily offline. No credentials were changed.
- [x] Keep a healthy preview server running on the configured port and verify the game starts after the fix, including standard and sea modes. Resident pnpm dev on 0.0.0.0:3000; local and external HTTP 200; browser confirms movement, firing, rendered geometry, and no JavaScript/engine errors in both modes. Build and 36 unit tests pass.
