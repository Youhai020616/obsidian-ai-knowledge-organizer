# Obsidian Community Plugin Submission Checklist

## Repository

- [ ] Public GitHub repository.
- [ ] `README.md` explains the plugin purpose and usage.
- [ ] `PRIVACY.md` explains local, OpenAI, Anthropic, Gemini, Ollama, URL import, and file import behavior.
- [ ] `PLUGIN_REVIEW.md` documents startup, privacy, write safety, and release self-audit.
- [ ] `SECURITY.md`, `SUPPORT.md`, and `CONTRIBUTING.md` are present for public repository maintenance.
- [ ] `LICENSE` is present.
- [ ] No secrets or generated test vault data committed.

## Release

- [ ] `manifest.json` has the correct `id`, `name`, `version`, `minAppVersion`, and `isDesktopOnly`.
- [ ] `versions.json` maps the plugin version to `minAppVersion`.
- [ ] GitHub release tag equals the manifest version.
- [ ] Release attaches:
  - [ ] `manifest.json`
  - [ ] `main.js`
  - [ ] `styles.css`

## Verification

Run before release:

```bash
npm ci
npm run verify:all -- --repo <owner>/<repo>
```

## Submission

Follow [PUBLISH.md](PUBLISH.md) for the public repository, beta release, BRAT, and submission sequence.

- [ ] Open a PR to `obsidianmd/obsidian-releases`.
- [ ] Generate the plugin entry with `npm run community:entry -- --repo <owner>/<repo> --check-upstream`.
- [ ] Generate the PR body with `npm run community:pr-body -- --repo <owner>/<repo> --platform macOS`.
- [ ] Add the generated plugin entry to `community-plugins.json`.
- [ ] Respond to review feedback without weakening the review-first safety model.
