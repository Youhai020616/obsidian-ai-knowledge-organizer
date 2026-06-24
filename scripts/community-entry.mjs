import { readFileSync } from 'node:fs';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const repo = args.repo ?? process.env.OBSIDIAN_PLUGIN_REPO;
const failures = [];

if (!repo) {
	failures.push('Provide --repo owner/repo or set OBSIDIAN_PLUGIN_REPO.');
} else if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo)) {
	failures.push(`Repository must use owner/repo format: ${repo}`);
}

const entry = {
	id: manifest.id,
	name: manifest.name,
	author: manifest.author,
	description: manifest.description,
	repo,
};

for (const [key, value] of Object.entries(entry)) {
	if (!String(value ?? '').trim()) {
		failures.push(`Missing community entry field: ${key}`);
	}
}

if (args.checkUpstream) {
	await checkUpstreamId(manifest.id);
}

if (failures.length > 0) {
	for (const failure of failures) {
		console.error(`community-entry: ${failure}`);
	}
	process.exit(1);
}

console.log(JSON.stringify(entry, null, 2));

function parseArgs(values) {
	const parsed = {
		checkUpstream: false,
		repo: undefined,
	};
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value === '--check-upstream') {
			parsed.checkUpstream = true;
		} else if (value === '--repo') {
			parsed.repo = values[index + 1];
			index += 1;
		} else if (value?.startsWith('--repo=')) {
			parsed.repo = value.slice('--repo='.length);
		} else {
			failures.push(`Unknown argument: ${value}`);
		}
	}
	return parsed;
}

async function checkUpstreamId(pluginId) {
	const response = await fetch(
		'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json',
	);
	if (!response.ok) {
		failures.push(`Could not fetch upstream community plugin list (${response.status}).`);
		return;
	}
	const plugins = await response.json();
	if (!Array.isArray(plugins)) {
		failures.push('Upstream community plugin list did not return an array.');
		return;
	}
	if (plugins.some((plugin) => plugin?.id === pluginId)) {
		failures.push(`Plugin id already exists upstream: ${pluginId}`);
	}
}
