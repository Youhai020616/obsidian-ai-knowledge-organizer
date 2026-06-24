import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const repo = parseRepo(process.argv.slice(2)) ?? process.env.OBSIDIAN_PLUGIN_REPO ?? '<owner>/<repo>';
const releaseDir = join('dist', 'release', `${manifest.id}-${manifest.version}`);
const outputPath = join(releaseDir, 'PUBLISH_REPORT.md');
const releaseFiles = [
	'manifest.json',
	'main.js',
	'styles.css',
	'RELEASE_NOTES.md',
];

if (!existsSync(releaseDir)) {
	mkdirSync(releaseDir, { recursive: true });
}

const branch = runText('git', ['branch', '--show-current']) || '(unknown)';
const origin = runText('git', ['remote', 'get-url', 'origin']) || '(none)';
const status = runText('git', ['status', '--short']);
const localTag = runText('git', ['tag', '--list', manifest.version]) || '(none)';
const releaseFileLines = releaseFiles.map((file) => {
	const path = join(releaseDir, file);
	return existsSync(path)
		? `- ${file}: ${statSync(path).size} bytes`
		: `- ${file}: missing`;
});
const betaVaultFiles = existsSync(join('.tmp', 'beta-vault'))
	? listFiles(join('.tmp', 'beta-vault')).map((file) => `- ${file}`)
	: ['- .tmp/beta-vault: missing'];

const body = [
	`# Publish Report: ${manifest.name} ${manifest.version}`,
	'',
	'## Target',
	'',
	`- Plugin ID: \`${manifest.id}\``,
	`- Version: \`${manifest.version}\``,
	`- Repository: \`${repo}\``,
	`- Branch: \`${branch}\``,
	`- Origin: \`${origin}\``,
	`- Local tag ${manifest.version}: \`${localTag}\``,
	'',
	'## Working Tree',
	'',
	status
		? 'Working tree has uncommitted changes. Commit before publishing.'
		: 'Working tree is clean.',
	'',
	status ? fenced(status) : '',
	'## Release Artifacts',
	'',
	...releaseFileLines,
	'',
	'## Local Beta Vault',
	'',
	...betaVaultFiles,
	'',
	'## Required Commands Before External Publish',
	'',
	fenced([
		`npm run verify:all -- --repo ${repo}`,
		`npm run publish:preflight -- --repo ${repo}`,
		`npm run community:pr-body -- --repo ${repo} --platform macOS`,
	].join('\n')),
	'## External Publish Steps',
	'',
	'These steps create or mutate external GitHub state and require explicit user confirmation.',
	'',
	fenced([
		`gh repo create ${repo} --public --source=. --remote=origin --push`,
		`git tag ${manifest.version}`,
		`git push origin ${manifest.version}`,
	].join('\n')),
	'',
].join('\n');

writeFileSync(outputPath, body);
console.log(`publish-report: wrote ${outputPath}`);

function parseRepo(values) {
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value === '--repo') {
			return values[index + 1];
		}
		if (value?.startsWith('--repo=')) {
			return value.slice('--repo='.length);
		}
	}
	return undefined;
}

function fenced(value) {
	return ['```text', value, '```', ''].join('\n');
}

function runText(command, commandArgs) {
	const result = spawnSync(command, commandArgs, {
		encoding: 'utf8',
		shell: process.platform === 'win32',
	});
	return result.status === 0 ? result.stdout.trim() : '';
}

function listFiles(root) {
	const result = [];
	visit(root);
	return result.sort();

	function visit(directory) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(path);
			} else if (entry.isFile()) {
				result.push(relative(root, path));
			}
		}
	}
}
