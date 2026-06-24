## Summary

Describe the change and the user workflow it affects.

## Safety Model

- [ ] AI-generated writes remain behind user review.
- [ ] Remote provider use remains opt-in.
- [ ] Update operations preserve backup and rollback behavior where applicable.
- [ ] No private vault content, API keys, or access tokens are included.

## Verification

- [ ] `npm run verify:all`
- [ ] Manual Obsidian test in `.tmp/beta-vault` if UI/write behavior changed.

## Documentation

- [ ] README, PRIVACY, PLUGIN_REVIEW, CHANGELOG, or other docs were updated if behavior changed.
