# Changelog

## 0.1.1

- Redact secret-like values before persisting conversation messages, and sanitize any existing conversation history on load.
- Internal: split `main.ts` into view, modals, and per-domain service modules (no behavior change).

## 0.1.0

- Created the Obsidian plugin scaffold.
- Added a conversational chat UI: top bar with a cross-conversation pending badge, a chat stream with proposal cards, and a bottom composer.
- Added slash commands (`/scan`, `/analyze`, `/audit`, `/govern`, `/reindex`, `/import`) with natural-language fallback to Ask Vault.
- Added an inline model picker limited to configured providers, with a per-conversation provider override.
- Added multi-turn conversation memory and Markdown-rendered assistant replies.
- Added an active-note vs whole-vault scope toggle for Ask Vault.
- Added secret redaction before content reaches a cloud provider or the UI.
- Added review-first analysis proposals.
- Added active note analysis and Inbox scan.
- Added selectable update/create operations.
- Added backup and rollback.
- Added Ask Vault with local retrieval and citations.
- Added vault audit.
- Added rich line-level diff previews.
- Added governance proposals for vault index, tags, and duplicate merge planning.
- Added local heuristic, OpenAI, Anthropic, Gemini, DeepSeek, and Ollama providers.
- Added URL import to Inbox with article/main content extraction.
- Added Markdown, text, PDF, and binary file import to Inbox.
- Added basic local PDF selectable-text extraction.
- Added persisted local search index.
- Added tests, linting, release checks, release packaging, community preflight checks, community submission generators, simulated install checks, and CI.
- Added integration coverage for selected vault writes, backups, and rollback.
- Added local beta smoke-test vault generation.
- Added generated GitHub release notes.
- Added security, support, and contributing documentation.
- Added GitHub issue forms and pull request template.
- Added read-only GitHub publish preflight.
- Added generated publish report.
- Added Markdown documentation link checks.
- Added provider selection and cloud API key fallback coverage.
- Deferred Inbox folder initialization until Obsidian layout ready.
- Added plugin review self-audit documentation.
- Strengthened release artifact integrity checks.
