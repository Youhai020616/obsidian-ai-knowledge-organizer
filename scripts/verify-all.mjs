import { spawnSync } from 'node:child_process';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const commands = [
	['npm', ['test']],
	['npm', ['run', 'lint']],
	['npm', ['run', 'docs:check']],
	['npm', ['run', 'build']],
	['npm', ['run', 'release:check']],
	['npm', ['run', 'package:release']],
	['npm', ['run', 'release:notes']],
	['npm', ['run', 'e2e:install']],
	['npm', ['run', 'beta:vault']],
	[
		'npm',
		args.repo
			? ['run', 'publish:report', '--', '--repo', args.repo]
			: ['run', 'publish:report'],
	],
	['npm', ['run', 'community:preflight']],
];

if (args.repo) {
	commands.push([
		'npm',
		[
			'run',
			'community:entry',
			'--',
			'--repo',
			args.repo,
			'--check-upstream',
		],
	]);
}

commands.push(
	['npm', ['audit', '--audit-level=moderate']],
	['git', ['diff', '--check']],
);

for (const [command, commandArgs] of commands) {
	console.log(`\nverify-all: ${command} ${commandArgs.join(' ')}`);
	const result = spawnSync(command, commandArgs, {
		stdio: 'inherit',
		shell: process.platform === 'win32',
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

console.log('\nverify-all: all checks passed.');

function parseArgs(values) {
	const parsed = {
		repo: process.env.OBSIDIAN_PLUGIN_REPO,
	};
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value === '--repo') {
			parsed.repo = values[index + 1];
			index += 1;
		} else if (value?.startsWith('--repo=')) {
			parsed.repo = value.slice('--repo='.length);
		} else {
			console.error(`verify-all: unknown argument: ${value}`);
			process.exit(1);
		}
	}
	return parsed;
}
