import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const failures = [];
const requiredDocs = [
	'README.md',
	'PRIVACY.md',
	'LICENSE',
	'SECURITY.md',
	'SUPPORT.md',
	'CONTRIBUTING.md',
	'BETA.md',
	'PUBLISH.md',
	'PLUGIN_REVIEW.md',
	'COMMUNITY_SUBMISSION.md',
	'CHANGELOG.md',
	'ROADMAP.md',
	'STATUS.md',
];
const releaseFiles = ['manifest.json', 'main.js', 'styles.css'];

for (const file of [...requiredDocs, 'manifest.json', 'versions.json']) {
	requireFile(file);
}
requireFile('.github/ISSUE_TEMPLATE/bug_report.yml');
requireFile('.github/ISSUE_TEMPLATE/feature_request.yml');
requireFile('.github/ISSUE_TEMPLATE/config.yml');
requireFile('.github/pull_request_template.md');
requireFile('scripts/community-entry.mjs');
requireFile('scripts/community-pr-body.mjs');
requireFile('scripts/create-beta-vault.mjs');
requireFile('scripts/docs-check.mjs');
requireFile('scripts/github-publish-preflight.mjs');
requireFile('scripts/publish-report.mjs');
requireFile('scripts/release-notes.mjs');
requireFile('scripts/verify-all.mjs');

const manifest = readJson('manifest.json');
const versions = readJson('versions.json');
const packageJson = readJson('package.json');

if (manifest.id !== 'ai-knowledge-organizer') {
	failures.push(`Unexpected manifest id: ${manifest.id}`);
}
if (manifest.name !== 'AI Knowledge Organizer') {
	failures.push(`Unexpected manifest name: ${manifest.name}`);
}
if (manifest.version !== packageJson.version) {
	failures.push('manifest.json version must match package.json version.');
}
if (versions[manifest.version] !== manifest.minAppVersion) {
	failures.push('versions.json must map manifest version to minAppVersion.');
}
if (packageJson.license !== 'MIT') {
	failures.push('package.json license must be MIT.');
}
if (!packageJson.scripts?.['community:entry']) {
	failures.push('package.json must define community:entry.');
}
if (!packageJson.scripts?.['beta:vault']) {
	failures.push('package.json must define beta:vault.');
}
if (!packageJson.scripts?.['docs:check']) {
	failures.push('package.json must define docs:check.');
}
if (!packageJson.scripts?.['release:notes']) {
	failures.push('package.json must define release:notes.');
}
if (!packageJson.scripts?.['publish:preflight']) {
	failures.push('package.json must define publish:preflight.');
}
if (!packageJson.scripts?.['publish:report']) {
	failures.push('package.json must define publish:report.');
}
if (!packageJson.scripts?.['community:pr-body']) {
	failures.push('package.json must define community:pr-body.');
}
if (!packageJson.scripts?.['verify:all']) {
	failures.push('package.json must define verify:all.');
}
if (!readFile('LICENSE').startsWith('MIT License')) {
	failures.push('LICENSE must contain the MIT license text.');
}

checkContains('README.md', [
	'Review-first AI knowledge organization',
	'OpenAI',
	'Anthropic',
	'Gemini',
	'DeepSeek',
	'Ollama',
	'npm run package:release',
]);
checkContains('PRIVACY.md', [
	'Local Mode',
	'OpenAI Mode',
	'Anthropic Mode',
	'Gemini Mode',
	'DeepSeek Mode',
	'Ollama Mode',
	'URL Import',
	'File and PDF Import',
]);
checkContains('SECURITY.md', [
	'Reporting a Vulnerability',
	'Security Model',
	'Do not include private vault content',
]);
checkContains('SUPPORT.md', [
	'Before Opening an Issue',
	'Do not include private note content',
	'Feature Requests',
]);
checkContains('CONTRIBUTING.md', [
	'npm run verify:all',
	'npm run docs:check',
	'Do not add silent AI writes',
	'Keep local heuristic mode working without network access',
]);
checkContains('.github/ISSUE_TEMPLATE/bug_report.yml', [
	'Do not include private note content',
	'Provider mode',
	'Affected workflow',
]);
checkContains('.github/ISSUE_TEMPLATE/feature_request.yml', [
	'AI proposes',
	'remote service unless the user opts in',
	'preserves backups or rollback',
]);
checkContains('.github/pull_request_template.md', [
	'AI-generated writes remain behind user review',
	'Remote provider use remains opt-in',
	'npm run verify:all',
]);
checkContains('COMMUNITY_SUBMISSION.md', [
	'obsidianmd/obsidian-releases',
	'npm run verify:all',
	'npm run community:entry',
	'npm run community:pr-body',
]);
checkContains('PUBLISH.md', [
	'gh repo create',
	'git tag 0.1.0',
	'npm run community:entry',
	'npm run community:pr-body',
	'npm run verify:all',
	'npm run beta:vault',
	'npm run release:notes',
	'npm run publish:preflight',
	'npm run publish:report',
	'BRAT',
	'obsidianmd/obsidian-releases',
]);
checkContains('PLUGIN_REVIEW.md', [
	'Startup and load time',
	'workspace.onLayoutReady',
	'Default provider is `Local heuristic`',
	'Update operations create backups',
	'npm run verify:all',
]);

const releaseDir = join('dist', 'release', `${manifest.id}-${manifest.version}`);
const releaseNotesPath = join(releaseDir, 'RELEASE_NOTES.md');
const publishReportPath = join(releaseDir, 'PUBLISH_REPORT.md');
for (const file of releaseFiles) {
	const source = file;
	const packaged = join(releaseDir, file);
	requireFile(source);
	requireFile(packaged);
	if (existsSync(source) && existsSync(packaged)) {
		const sourceContent = readFile(source);
		const packagedContent = readFile(packaged);
		if (sourceContent !== packagedContent) {
			failures.push(`Packaged ${file} does not match root ${file}.`);
		}
	}
}
requireFile(releaseNotesPath);
checkContains(releaseNotesPath, [
	`${manifest.name} ${manifest.version}`,
	'## Installation',
	'## Changes',
	'## Verification',
]);
requireFile(publishReportPath);
checkContains(publishReportPath, [
	`Publish Report: ${manifest.name} ${manifest.version}`,
	'## Release Artifacts',
	'## Required Commands Before External Publish',
	'## External Publish Steps',
]);

checkContains('.github/workflows/ci.yml', [
	'npm test',
	'npm run lint',
	'npm run docs:check',
	'npm run build',
	'npm run package:release',
	'npm run release:notes',
	'npm run publish:report',
	'npm run community:preflight',
	'npm audit --audit-level=moderate',
]);
checkContains('.github/workflows/release.yml', [
	'Verify tag matches manifest version',
	'npm run docs:check',
	'npm run package:release',
	'npm run publish:report',
	'npm run community:preflight',
	'gh release create',
	'--notes-file',
]);

if (existsSync('.github/workflows/lint.yml')) {
	failures.push('Remove duplicate .github/workflows/lint.yml; CI owns linting.');
}

for (const finding of findPotentialSecrets('.')) {
	failures.push(`Potential secret-like token in ${finding}`);
}

if (failures.length > 0) {
	for (const failure of failures) {
		console.error(`community-preflight: ${failure}`);
	}
	process.exit(1);
}

console.log(
	`community-preflight: ${manifest.name} ${manifest.version} is ready for public release prep.`,
);

function requireFile(path) {
	if (!existsSync(path)) {
		failures.push(`Missing ${path}`);
		return;
	}
	if (statSync(path).isFile() && statSync(path).size === 0) {
		failures.push(`${path} is empty`);
	}
}

function readJson(path) {
	if (!existsSync(path)) {
		return {};
	}
	return JSON.parse(readFile(path));
}

function readFile(path) {
	return readFileSync(path, 'utf8');
}

function checkContains(path, snippets) {
	if (!existsSync(path)) {
		failures.push(`Missing ${path}`);
		return;
	}
	const content = readFile(path);
	for (const snippet of snippets) {
		if (!content.includes(snippet)) {
			failures.push(`${path} must include: ${snippet}`);
		}
	}
}

function findPotentialSecrets(root) {
	const ignoredDirs = new Set([
		'.git',
		'.tmp',
		'dist',
		'node_modules',
	]);
	const ignoredFiles = new Set([
		'main.js',
		'package-lock.json',
	]);
	const matches = [];
	const patterns = [
		/sk-[A-Za-z0-9_-]{20,}/u,
		/gh[opsru]_[A-Za-z0-9_]{20,}/u,
		/xox[baprs]-[A-Za-z0-9-]{20,}/u,
		/AKIA[0-9A-Z]{16}/u,
	];
	visit(root);
	return matches;

	function visit(directory) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (ignoredDirs.has(entry.name)) {
				continue;
			}
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(path);
				continue;
			}
			if (!entry.isFile() || ignoredFiles.has(entry.name)) {
				continue;
			}
			const content = readFile(path);
			if (patterns.some((pattern) => pattern.test(content))) {
				matches.push(relative(root, path));
			}
		}
	}
}
