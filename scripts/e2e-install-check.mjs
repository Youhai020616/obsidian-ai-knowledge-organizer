import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const pluginId = 'ai-knowledge-organizer';
const root = join('.tmp', 'e2e-vault');
const installDir = join(root, '.obsidian', 'plugins', pluginId);
const releaseFiles = ['manifest.json', 'main.js', 'styles.css'];
const failures = [];

rmSync(root, { force: true, recursive: true });
mkdirSync(installDir, { recursive: true });

for (const file of releaseFiles) {
	cpSync(file, join(installDir, file));
}

for (const file of releaseFiles) {
	const target = join(installDir, file);
	if (!existsSync(target)) {
		failures.push(`Missing installed file ${target}`);
		continue;
	}
	if (statSync(target).size === 0) {
		failures.push(`Installed file is empty: ${target}`);
	}
}

const manifest = JSON.parse(readFileSync(join(installDir, 'manifest.json'), 'utf8'));
if (manifest.id !== pluginId) {
	failures.push(`Installed manifest id mismatch: ${manifest.id}`);
}

const bundle = readFileSync(join(installDir, 'main.js'), 'utf8');
if (!bundle.includes('AI Knowledge Organizer') && !bundle.includes('AI knowledge organizer')) {
	failures.push('Bundle does not appear to contain the plugin implementation.');
}

if (failures.length > 0) {
	for (const failure of failures) {
		console.error(`e2e-install-check: ${failure}`);
	}
	process.exit(1);
}

console.log(`e2e-install-check: installed ${pluginId} into ${installDir}`);
