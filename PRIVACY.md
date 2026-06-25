# Privacy Policy

AI Knowledge Organizer is designed as a local-first Obsidian plugin.

## Local Mode

The default provider is `Local heuristic`. In this mode, note analysis and Ask Vault run locally inside Obsidian. No note content is sent to a remote AI service.

## OpenAI Mode

If you select `OpenAI` and provide an API key, the plugin sends the current note content, retrieved candidate note excerpts, the active-note excerpt when **Active note** scope is selected, and up to recent redacted conversation turns used as context to the OpenAI Responses API. The context size is capped by the `Maximum context characters` setting, and secret-like values are best-effort redacted before provider requests.

## Anthropic Mode

If you select `Anthropic` and provide an API key, the plugin sends the current note content, retrieved candidate note excerpts, the active-note excerpt when **Active note** scope is selected, and up to recent redacted conversation turns used as context to the Anthropic Messages API. The context size is capped by the `Maximum context characters` setting, and secret-like values are best-effort redacted before provider requests.

## Gemini Mode

If you select `Gemini` and provide an API key, the plugin sends the current note content, retrieved candidate note excerpts, the active-note excerpt when **Active note** scope is selected, and up to recent redacted conversation turns used as context to the Gemini generateContent API. The context size is capped by the `Maximum context characters` setting, and secret-like values are best-effort redacted before provider requests.

## DeepSeek Mode

If you select `DeepSeek` and provide an API key, the plugin sends the current note content, retrieved candidate note excerpts, the active-note excerpt when **Active note** scope is selected, and up to recent redacted conversation turns used as context to the configured DeepSeek Chat Completions API base URL. The context size is capped by the `Maximum context characters` setting, and secret-like values are best-effort redacted before provider requests.

## Ollama Mode

If you select `Ollama`, the plugin sends prompts, relevant excerpts, active-note context when enabled, and up to recent redacted conversation turns to the configured Ollama URL, which defaults to `http://127.0.0.1:11434`. Keep this URL local unless you intentionally operate a trusted remote Ollama server.

## URL Import

URL import fetches the URL you provide and stores a Markdown copy in the configured Inbox folder. The fetched page content stays in your vault after import.

## File and PDF Import

Markdown and text files are copied into the configured Inbox folder. PDF and other binary files are copied into the Inbox attachments folder, and the plugin creates a source note that links to the attachment. PDF import attempts basic selectable-text extraction from the file locally; it does not perform OCR.

## Storage

- Plugin settings are stored in Obsidian plugin data.
- API keys for OpenAI, Anthropic, Gemini, and DeepSeek are stored locally in Obsidian plugin data.
- Backups are written to the configured backup folder before accepted updates are applied.
- Review proposals are stored locally in Obsidian plugin data and can include before/after note bodies, generated new-note content, paths, and rationale until you clear plugin data.
- Audit log entries are stored locally and describe actions, paths, and errors.
- Conversation messages are stored locally in Obsidian plugin data. Citation buttons store note path and basename; provider excerpts are not copied into persisted chat messages.
- The last Ask Vault answer may store its redacted answer and redacted citation excerpts for backward compatibility.
- The search index is stored locally in Obsidian plugin data. It contains note-derived terms and excerpts and can be rebuilt from the vault.

## User Control

The plugin does not silently write AI changes. Every AI-generated write is represented as a proposal in the review queue. You can accept, reject, or roll back supported proposals.
