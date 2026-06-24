import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const pluginId = manifest.id;
const root = join('.tmp', 'beta-vault');
const pluginDir = join(root, '.obsidian', 'plugins', pluginId);
const releaseFiles = ['manifest.json', 'main.js', 'styles.css'];
const failures = [];

for (const file of releaseFiles) {
	if (!existsSync(file)) {
		failures.push(`Missing release file: ${file}`);
		continue;
	}
	if (statSync(file).size === 0) {
		failures.push(`Release file is empty: ${file}`);
	}
}

if (failures.length > 0) {
	for (const failure of failures) {
		console.error(`create-beta-vault: ${failure}`);
	}
	process.exit(1);
}

rmSync(root, { force: true, recursive: true });
mkdirSync(pluginDir, { recursive: true });
mkdirSync(join(root, 'AI Inbox'), { recursive: true });
mkdirSync(join(root, 'Projects'), { recursive: true });
mkdirSync(join(root, 'Reference'), { recursive: true });
mkdirSync(join(root, '.obsidian'), { recursive: true });

for (const file of releaseFiles) {
	cpSync(file, join(pluginDir, file));
}

writeJson(join(root, '.obsidian', 'community-plugins.json'), [pluginId]);
writeJson(join(pluginDir, 'data.json'), {
	settings: {
		provider: 'heuristic',
		inboxFolder: 'AI Inbox',
		backupFolder: '.ai-organizer/backups',
		autoCreateInbox: true,
	},
	state: {
		proposals: [],
		auditLog: [],
	},
});

writeFileSync(
	join(root, 'AI Inbox', 'meeting-notes.md'),
	[
		'# Meeting notes',
		'',
		'We discussed a review-first AI workflow for organizing project notes.',
		'The assistant should propose changes, show diffs, create backups, and support rollback.',
		'Follow up by linking this note to the release checklist and privacy review.',
		'',
	].join('\n'),
);

writeFileSync(
	join(root, 'Projects', 'AI Knowledge Organizer.md'),
	[
		'---',
		'tags:',
		'  - ai',
		'  - obsidian',
		'---',
		'',
		'# AI Knowledge Organizer',
		'',
		'Review-first plugin for proposing safe vault organization changes.',
		'',
	].join('\n'),
);

writeFileSync(
	join(root, 'Reference', 'Release checklist.md'),
	[
		'# Release checklist',
		'',
		'- Run `npm run verify:all`.',
		'- Confirm release files are attached individually.',
		'- Test install flow in a copied vault.',
		'',
	].join('\n'),
);

writeFileSync(
	join(root, 'README.md'),
	[
		'# AI Knowledge Organizer beta vault',
		'',
		'Open this folder as an Obsidian vault to test the local beta build.',
		'',
		'Suggested flow:',
		'',
		'1. Enable community plugins if needed.',
		'2. Enable AI Knowledge Organizer.',
		'3. Open `AI Inbox/meeting-notes.md`.',
		'4. Run `AI Knowledge Organizer: Analyze active note`.',
		'5. Review, apply, and rollback the generated proposal.',
		'',
	].join('\n'),
);

console.log(`create-beta-vault: prepared ${root}`);
console.log(`create-beta-vault: installed ${pluginId} ${manifest.version}`);

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
