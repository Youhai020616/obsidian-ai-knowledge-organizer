# Beta Install Guide

Use this path before the plugin is accepted into the Obsidian Community Plugins directory.

## Option 1: Manual install

1. Download `manifest.json`, `main.js`, and `styles.css` from a GitHub release, or run `npm run package:release` locally and use the files in `dist/release/ai-knowledge-organizer-0.1.0/`.
2. Create this folder in your vault:

```text
VaultFolder/.obsidian/plugins/ai-knowledge-organizer/
```

3. Copy the three release files into that folder.
4. Reload Obsidian.
5. Enable `AI Knowledge Organizer` in Community Plugins.

## Option 2: BRAT

1. Install the BRAT community plugin.
2. Use `Add beta plugin`.
3. Enter the GitHub repository URL for this plugin.
4. Enable `AI Knowledge Organizer`.

## First beta test

For a local smoke-test vault, run:

```bash
npm run beta:vault
```

Then open `.tmp/beta-vault` as an Obsidian vault.

1. Keep provider set to `Local heuristic`.
2. Open or create a test note.
3. Run `AI Knowledge Organizer: Analyze active note`.
4. Review the proposed operations.
5. Apply the proposal.
6. Confirm a backup was created in `.ai-organizer/backups`.
7. Run rollback and confirm the original note is restored.

## Safety rule

Do not beta test on your only copy of a vault. Use Obsidian Sync history, Git, or a copied test vault until you trust the plugin.
