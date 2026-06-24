# Privacy Policy

AI Knowledge Organizer is designed as a local-first Obsidian plugin.

## Local Mode

The default provider is `Local heuristic`. In this mode, note analysis and Ask Vault run locally inside Obsidian. No note content is sent to a remote AI service.

## OpenAI Mode

If you select `OpenAI` and provide an API key, the plugin sends the current note content and retrieved candidate note excerpts to the OpenAI Responses API for the operation you request. The context size is capped by the `Maximum context characters` setting.

## Anthropic Mode

If you select `Anthropic` and provide an API key, the plugin sends the current note content and retrieved candidate note excerpts to the Anthropic Messages API for the operation you request. The context size is capped by the `Maximum context characters` setting.

## Gemini Mode

If you select `Gemini` and provide an API key, the plugin sends the current note content and retrieved candidate note excerpts to the Gemini generateContent API for the operation you request. The context size is capped by the `Maximum context characters` setting.

## DeepSeek Mode

If you select `DeepSeek` and provide an API key, the plugin sends the current note content and retrieved candidate note excerpts to the configured DeepSeek Chat Completions API base URL for the operation you request. The context size is capped by the `Maximum context characters` setting.

## Ollama Mode

If you select `Ollama`, the plugin sends prompts to the configured Ollama URL, which defaults to `http://127.0.0.1:11434`. Keep this URL local unless you intentionally operate a trusted remote Ollama server.

## URL Import

URL import fetches the URL you provide and stores a Markdown copy in the configured Inbox folder. The fetched page content stays in your vault after import.

## File and PDF Import

Markdown and text files are copied into the configured Inbox folder. PDF and other binary files are copied into the Inbox attachments folder, and the plugin creates a source note that links to the attachment. PDF import attempts basic selectable-text extraction from the file locally; it does not perform OCR.

## Storage

- Plugin settings are stored in Obsidian plugin data.
- API keys for OpenAI, Anthropic, Gemini, and DeepSeek are stored locally in Obsidian plugin data.
- Backups are written to the configured backup folder before accepted updates are applied.
- Audit log entries are stored locally and describe actions, paths, and errors.
- The search index is stored locally in Obsidian plugin data and can be rebuilt from the vault.

## User Control

The plugin does not silently write AI changes. Every AI-generated write is represented as a proposal in the review queue. You can accept, reject, or roll back supported proposals.
