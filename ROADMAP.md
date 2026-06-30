# Development Plan

## Phase 0: Product Definition

- Positioning: review-first AI knowledge organizer for Obsidian.
- Differentiator: safe proposals, visible diffs, backup, rollback.
- Primary users: researchers, writers, students, developers, PKM-heavy Obsidian users.

## Phase 1: Project Foundation

- Obsidian plugin scaffold.
- TypeScript build.
- Manifest, release files, README, privacy policy.

## Phase 2: MVP Review Loop

- Analyze active note.
- Generate structured organization proposal.
- Show pending operations.
- Apply selected operations.
- Reject proposals.

## Phase 3: Inbox and Ask Vault

- Scan configured Inbox folder.
- Batch proposal creation.
- Ask Vault panel with local retrieval and citations.
- Vault audit for orphan notes, broken wikilinks, duplicate titles, and missing frontmatter.
- URL import to Inbox.
- File and PDF import to Inbox.

## Phase 4: Safety and Trust

- Back up files before update operations.
- Roll back applied proposals.
- Audit log.
- Local heuristic provider for no-egress dry runs.
- OpenAI provider as opt-in.
- Anthropic provider as opt-in.
- Gemini provider as opt-in.

## Phase 5: Beta Hardening

- More tests.
- Better diff rendering.
- BRAT install support.
- Example vault QA.
- GitHub Actions CI.
- Release file check.
- Release package script.
- Simulated Obsidian plugin install check.
- Community submission preflight check.
- Beta install guide.
- Community submission checklist.

## Phase 6: Full Version

- Multiple AI providers.
- Local Ollama provider.
- BM25-style retrieval.
- Persisted local search index.
- PDF attachment import with source notes and basic selectable-text extraction.
- Higher-fidelity web import with article/main content extraction.
- Tag governance.
- Duplicate and orphan detection.
- MOC/index generation.
- Conversational agent UI with slash commands, inline model picker, multi-turn memory, and secret redaction.
- Community plugin submission.

## External Release Steps

- Publish a public GitHub repository.
- Create a GitHub release with `manifest.json`, `main.js`, and `styles.css`.
- Test BRAT installation from the public repository.
- Open the Obsidian Community Plugins submission PR.
