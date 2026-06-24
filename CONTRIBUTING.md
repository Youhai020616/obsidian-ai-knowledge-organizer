# Contributing

Contributions should keep the plugin local-first, review-first, and safe to test in copied vaults.

## Development Setup

```bash
npm install
npm run verify:all
```

For manual Obsidian testing:

```bash
npm run build
npm run beta:vault
```

Open `.tmp/beta-vault` in Obsidian and enable `AI Knowledge Organizer`.

## Engineering Rules

- Do not add silent AI writes.
- Do not send note content to remote providers unless the user explicitly selected that provider and configured credentials.
- Keep local heuristic mode working without network access.
- Preserve backup and rollback behavior for update operations.
- Add tests for new shared behavior or write paths.
- Keep release files limited to `manifest.json`, `main.js`, and `styles.css`.

## Verification

Before opening a pull request, run:

```bash
npm run verify:all -- --repo <owner>/<repo>
```

For documentation-only changes, `npm run docs:check` verifies local Markdown links.

If the public repository does not exist yet, run:

```bash
npm run verify:all
```

Use the pull request template and keep the safety-model checklist accurate.

## Documentation

Update the relevant docs when behavior changes:

- `README.md` for user-facing workflows.
- `PRIVACY.md` for data flow or provider changes.
- `PLUGIN_REVIEW.md` for review-sensitive implementation changes.
- `CHANGELOG.md` for release-visible changes.
