# Plugin Review Self-Audit

This checklist tracks review-sensitive areas before public submission.

## Startup and load time

- `onload` registers commands, views, settings, ribbon, and status bar only.
- Vault writes for auto-created Inbox folders are deferred with `workspace.onLayoutReady`.
- No provider request, vault scan, URL fetch, indexing pass, or audit run starts automatically on plugin load.
- Production releases are built with `npm run build`, which disables sourcemaps and minifies `main.js`.

## Data access and privacy

- Default provider is `Local heuristic`; it does not send note content to remote services.
- OpenAI, Anthropic, Gemini, DeepSeek, and non-local Ollama endpoints are opt-in settings.
- Remote providers receive only user-triggered context: the source note or Ask Vault question, retrieved candidate excerpts, active-note excerpt when that scope is enabled, and recent redacted conversation turns needed for the current request.
- Secret-like values are best-effort redacted before provider requests and before chat messages are persisted.
- URL import only fetches a URL entered by the user.
- PDF extraction runs locally and does not perform OCR.

## Write safety

- AI output is converted into review proposals.
- The plugin does not silently apply AI-generated writes.
- Users can toggle individual operations before applying.
- Update operations create backups before modifying files.
- Applied proposals can be rolled back when backups exist.
- Integration tests cover selected writes, backups, and rollback.

## Release readiness

- Release artifacts are `manifest.json`, `main.js`, and `styles.css`.
- GitHub release tags must exactly match `manifest.json` version.
- `versions.json` maps the current plugin version to `minAppVersion`.
- `npm run release:check` verifies release files, metadata consistency, production bundle shape, Obsidian API externalization, and absence of root sourcemaps.
- `npm run release:notes` generates the GitHub release body from `manifest.json` and `CHANGELOG.md`.
- `npm run verify:all -- --repo <owner>/<repo>` runs the local release gate.
- `npm run community:entry -- --repo <owner>/<repo> --check-upstream` generates the community plugin entry.
- `npm run community:pr-body -- --repo <owner>/<repo> --platform macOS` generates the submission PR body.
