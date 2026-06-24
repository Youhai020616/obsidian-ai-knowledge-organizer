# Support

Use the GitHub issue templates in the public repository for support after the repository is published.

## Before Opening an Issue

1. Run `npm run verify:all -- --repo <owner>/<repo>` if you are testing from source.
2. Reproduce the issue in a copied vault or the generated `.tmp/beta-vault`.
3. Keep provider set to `Local heuristic` unless the issue is specifically about a remote provider.

## Include in Bug Reports

- Obsidian version.
- Operating system.
- Plugin version.
- Provider mode.
- Command or workflow used.
- Whether the affected operation was analyze, apply, rollback, Ask Vault, audit, governance, URL import, or file import.
- Relevant audit log message from the plugin panel.

Do not include private note content, API keys, or access tokens.

## Feature Requests

Feature requests should preserve the review-first safety model:

- AI proposes changes.
- The user approves writes.
- Updates are backed up before modification.
- Rollback remains available for applied proposals where possible.
