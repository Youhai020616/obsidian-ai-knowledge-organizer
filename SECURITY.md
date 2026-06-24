# Security Policy

AI Knowledge Organizer is an Obsidian plugin that can read vault notes when the user runs plugin commands. It is designed to keep AI-generated writes behind review, backups, and rollback.

## Supported Versions

Only the latest released version is supported for security fixes.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting a Vulnerability

Report security issues privately through the GitHub repository security advisory flow after the public repository exists. If advisories are not available, open a minimal issue that asks for a private contact path without including exploit details.

Please include:

- Plugin version.
- Obsidian version and platform.
- Provider mode used: Local heuristic, OpenAI, Anthropic, Gemini, or Ollama.
- Whether the issue involves vault reads, writes, backups, rollback, URL import, file import, or provider requests.
- Clear reproduction steps using a copied test vault.

Do not include private vault content, API keys, or access tokens in reports.

## Security Model

- Local heuristic mode does not send note content to remote AI providers.
- Cloud provider modes are opt-in and use locally stored API keys.
- URL import fetches only URLs entered by the user.
- AI-generated changes are proposals until the user applies them.
- Update operations create backups before writing.
- Rollback restores backed-up update operations and removes created files from applied proposals.
