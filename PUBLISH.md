# Publish Runbook

This runbook covers the external steps after local verification passes.

## 1. Final local verification

```bash
npm ci
npm run verify:all -- --repo <owner>/<repo>
```

Review `PLUGIN_REVIEW.md` before publishing.

The release files are generated in:

```text
dist/release/ai-knowledge-organizer-0.1.0/
```

GitHub release notes are generated at:

```text
dist/release/ai-knowledge-organizer-0.1.0/RELEASE_NOTES.md
```

To regenerate them directly:

```bash
npm run release:notes
```

The publish report is generated at:

```text
dist/release/ai-knowledge-organizer-0.1.0/PUBLISH_REPORT.md
```

To regenerate it directly:

```bash
npm run publish:report -- --repo <owner>/<repo>
```

The local beta smoke-test vault is generated in:

```text
.tmp/beta-vault/
```

To regenerate it directly:

```bash
npm run beta:vault
```

## 2. Create the public repository

Run a read-only GitHub publish preflight:

```bash
npm run publish:preflight -- --repo <owner>/<repo>
```

Choose the final repository name, then create and push:

```bash
git remote add origin https://github.com/<owner>/<repo>.git
git branch -M main
git push -u origin main
```

If using GitHub CLI:

```bash
gh repo create <owner>/<repo> --public --source=. --remote=origin --push
```

## 3. Create the beta release

Use a tag that exactly matches `manifest.json` version:

```bash
git tag 0.1.0
git push origin 0.1.0
```

The release workflow creates a draft GitHub release with:

- `manifest.json`
- `main.js`
- `styles.css`

Review and publish the draft release.

## 4. Test with BRAT

1. Install the BRAT community plugin in a test vault.
2. Add the public GitHub repository URL as a beta plugin.
3. Enable `AI Knowledge Organizer`.
4. Run the first-test flow in `BETA.md`.

## 5. Submit to Obsidian Community Plugins

1. Fork `obsidianmd/obsidian-releases`.
2. Generate the plugin entry:

```bash
npm run community:entry -- --repo <owner>/<repo> --check-upstream
```

3. Generate the PR body:

```bash
npm run community:pr-body -- --repo <owner>/<repo> --platform macOS
```

4. Add the generated JSON object to `community-plugins.json` in alphabetical position by plugin name.
5. Confirm the generated entry uses:
   - Plugin ID: `ai-knowledge-organizer`
   - Repository: `<owner>/<repo>`
   - Release version: `0.1.0`
6. Open the PR using the generated PR body.
7. Respond to review feedback without weakening the review-first safety model.
