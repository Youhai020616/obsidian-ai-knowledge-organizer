import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const repo = args.repo ?? process.env.OBSIDIAN_PLUGIN_REPO;
const failures = [];
const warnings = [];

if (!repo) {
	failures.push('Provide --repo owner/repo or set OBSIDIAN_PLUGIN_REPO.');
} else if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo)) {
	failures.push(`Repository must use owner/repo format: ${repo}`);
}

const ghAuth = run('gh', ['auth', 'status']);
if (ghAuth.status !== 0) {
	failures.push('GitHub CLI is not authenticated. Run `gh auth login` first.');
}

const currentBranch = runText('git', ['branch', '--show-current']);
const origin = runText('git', ['remote', 'get-url', 'origin']);
const status = runText('git', ['status', '--short']);
const localTag = runText('git', ['tag', '--list', manifest.version]);

if (!currentBranch) {
	warnings.push('Could not determine the current git branch.');
}
if (!origin) {
	warnings.push('No git remote named origin is configured yet.');
}
if (status) {
	warnings.push('Working tree has uncommitted changes. Commit before publishing.');
}
if (localTag) {
	warnings.push(`Local tag ${manifest.version} already exists.`);
}

let repoView = null;
if (repo) {
	const view = run('gh', [
		'repo',
		'view',
		repo,
		'--json',
		'nameWithOwner,visibility,url',
	]);
	if (view.status === 0) {
		repoView = JSON.parse(view.stdout);
		warnings.push(`Repository already exists or is accessible: ${repoView.url}`);
	} else {
		warnings.push(`Repository is not currently accessible via gh: ${repo}`);
	}
}

console.log(`github-publish-preflight: plugin ${manifest.id} ${manifest.version}`);
console.log(`github-publish-preflight: repo ${repo ?? '(not set)'}`);
console.log(`github-publish-preflight: branch ${currentBranch || '(unknown)'}`);
console.log(`github-publish-preflight: origin ${origin || '(none)'}`);
console.log(
	`github-publish-preflight: target release tag ${manifest.version}`,
);
if (repoView) {
	console.log(
		`github-publish-preflight: repo visibility ${repoView.visibility}`,
	);
}

for (const warning of warnings) {
	console.warn(`github-publish-preflight: warning: ${warning}`);
}

if (failures.length > 0 || (args.strict && warnings.length > 0)) {
	for (const failure of failures) {
		console.error(`github-publish-preflight: ${failure}`);
	}
	if (args.strict && warnings.length > 0) {
		console.error('github-publish-preflight: strict mode treats warnings as failures.');
	}
	process.exit(1);
}

console.log('github-publish-preflight: read-only checks complete.');

function parseArgs(values) {
	const parsed = {
		repo: undefined,
		strict: false,
	};
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value === '--repo') {
			parsed.repo = values[index + 1];
			index += 1;
		} else if (value?.startsWith('--repo=')) {
			parsed.repo = value.slice('--repo='.length);
		} else if (value === '--strict') {
			parsed.strict = true;
		} else {
			console.error(`github-publish-preflight: unknown argument: ${value}`);
			process.exit(1);
		}
	}
	return parsed;
}

function runText(command, commandArgs) {
	const result = run(command, commandArgs);
	return result.status === 0 ? result.stdout.trim() : '';
}

function run(command, commandArgs) {
	const result = spawnSync(command, commandArgs, {
		encoding: 'utf8',
		shell: process.platform === 'win32',
	});
	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
}
