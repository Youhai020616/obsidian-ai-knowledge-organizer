# AI Knowledge Organizer for Obsidian

Review-first AI knowledge organization for Obsidian.

The plugin helps users organize notes without giving an AI direct, silent write access to the vault. It analyzes notes, creates a review proposal, shows every operation before it writes, backs up updated files, and supports rollback for applied proposals.

## Current MVP

- Analyze the active Markdown note.
- Scan a configured Inbox folder.
- Generate a review queue with update/create operations.
- Toggle individual operations before applying.
- Back up files before writes.
- Roll back applied proposals.
- Ask questions across the vault with note citations.
- Run a vault audit for orphan notes, broken wikilinks, duplicate titles, and missing frontmatter.
- Generate reviewable governance proposals for vault index, tag governance, and duplicate merge planning.
- Import web pages into the Inbox as Markdown with article/main content extraction.
- Import Markdown, text, PDF, and other files into the Inbox; PDFs are stored as attachments with source notes and basic selectable-text extraction.
- Use a local heuristic provider by default.
- Switch to OpenAI through the Responses API when an API key is configured.
- Switch to Anthropic through the Messages API when an API key is configured.
- Switch to Gemini through the generateContent API when an API key is configured.
- Switch to DeepSeek through the Chat Completions API when an API key is configured.
- Use local Ollama through `POST /api/generate` when configured.

## Product Principle

AI can suggest. The user decides what gets written.

## Development

```bash
npm install
npm run build
```

Full verification:

```bash
npm run verify:all
```

Documentation link check:

```bash
npm run docs:check
```

For live development, copy or symlink this folder into:

```text
VaultFolder/.obsidian/plugins/ai-knowledge-organizer/
```

Then run:

```bash
npm run dev
```

Reload Obsidian and enable the plugin in Community Plugins.

## Manual Install

Copy these release files into:

```text
VaultFolder/.obsidian/plugins/ai-knowledge-organizer/
```

- `manifest.json`
- `main.js`
- `styles.css`

`npm run package:release` prepares the same three files in `dist/release/ai-knowledge-organizer-0.1.0/`.
`npm run release:notes` writes GitHub release notes to `dist/release/ai-knowledge-organizer-0.1.0/RELEASE_NOTES.md`.
`npm run beta:vault` prepares a local smoke-test vault in `.tmp/beta-vault/`.

See [BETA.md](BETA.md) for beta install and first-test steps.
See [PUBLISH.md](PUBLISH.md) for the public repository, beta release, BRAT, and Obsidian Community Plugins submission runbook.
See [PLUGIN_REVIEW.md](PLUGIN_REVIEW.md) for the startup, privacy, write safety, and release self-audit.
See [SECURITY.md](SECURITY.md), [SUPPORT.md](SUPPORT.md), and [CONTRIBUTING.md](CONTRIBUTING.md) for public repository maintenance guidance.

To generate the Obsidian community plugin entry after the public repository exists:

```bash
npm run community:entry -- --repo <owner>/<repo> --check-upstream
```

To generate the Obsidian community submission PR body:

```bash
npm run community:pr-body -- --repo <owner>/<repo> --platform macOS
```

To run a read-only GitHub publish preflight:

```bash
npm run publish:preflight -- --repo <owner>/<repo>
```

To generate the local publish report:

```bash
npm run publish:report -- --repo <owner>/<repo>
```

## Privacy

The default provider is local heuristic mode and does not send note content to a remote model. If OpenAI, Anthropic, Gemini, or DeepSeek is selected and an API key is configured, note excerpts and candidate note excerpts used for the current operation are sent to that provider. If Ollama is selected, requests are sent to the configured local Ollama endpoint. URL import fetches the requested web page and saves a Markdown copy into the Inbox.

## Roadmap

- v0.1: Single note analysis, Inbox scan, Ask Vault, persisted local index, vault audit, governance proposals, URL/file/PDF import, multi-provider support, review queue, apply/reject, backup/rollback.
- v0.2: Stronger failure isolation, richer import handling, and higher fidelity extraction.
- v0.3: Better retrieval with persisted local index and citations.
- v0.4: More privacy controls and audit exports.
- v0.5: BRAT beta release.
- v1.0: Community plugin submission readiness.
