import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const version = manifest.version;
const releaseDir = join('dist', 'release', `${manifest.id}-${version}`);
const outputPath = join(releaseDir, 'RELEASE_NOTES.md');
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const changes = extractVersionChanges(changelog, version);

if (!existsSync(releaseDir)) {
	mkdirSync(releaseDir, { recursive: true });
}

if (changes.length === 0) {
	console.error(`release-notes: CHANGELOG.md has no section for ${version}.`);
	process.exit(1);
}

const body = [
	`# ${manifest.name} ${version}`,
	'',
	manifest.description,
	'',
	'## Installation',
	'',
	'Download the release assets individually into your Obsidian vault plugin folder:',
	'',
	`- \`manifest.json\``,
	`- \`main.js\``,
	`- \`styles.css\``,
	'',
	'Do not install from the source archive alone; Obsidian downloads the release assets directly.',
	'',
	'## Changes',
	'',
	...changes,
	'',
	'## Verification',
	'',
	'This release is built by `npm run verify:all`, covering tests, lint, production build, release checks, package generation, simulated install, beta vault generation, community preflight, audit, and diff checks.',
	'',
].join('\n');

writeFileSync(outputPath, body);
console.log(`release-notes: wrote ${outputPath}`);

function extractVersionChanges(changelogText, targetVersion) {
	const lines = changelogText.split(/\r?\n/u);
	const start = lines.findIndex((line) => line.trim() === `## ${targetVersion}`);
	if (start < 0) {
		return [];
	}
	const result = [];
	for (let index = start + 1; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (line.startsWith('## ')) {
			break;
		}
		if (line.trim()) {
			result.push(line);
		}
	}
	return result;
}
