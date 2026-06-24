import { readFileSync } from 'node:fs';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const repo = args.repo ?? process.env.OBSIDIAN_PLUGIN_REPO ?? '<owner>/<repo>';
const repoUrl = repo.startsWith('http') ? repo : `https://github.com/${repo}`;
const platforms = args.platforms.length > 0 ? args.platforms : ['macOS'];

console.log(
	[
		'# I am submitting a new Community Plugin',
		'',
		'I attest that I have done my best to deliver a high-quality plugin, am proud of the code I have written, and would recommend it to others. I commit to maintaining the plugin and being responsive to bug reports. If I am no longer able to maintain it, I will make reasonable efforts to find a successor maintainer or withdraw the plugin from the directory.',
		'',
		'## Repo URL',
		'',
		`Link to my plugin: ${repoUrl}`,
		'',
		'## Plugin Entry',
		'',
		'```json',
		JSON.stringify(
			{
				id: manifest.id,
				name: manifest.name,
				author: manifest.author,
				description: manifest.description,
				repo: repo.replace(/^https:\/\/github\.com\//u, ''),
			},
			null,
			2,
		),
		'```',
		'',
		'## Release Checklist',
		'',
		'- [x] I have tested the plugin on',
		...platforms.map((platform) => `  - [x] ${platform}`),
		'- [x] My GitHub release contains all required files as individual files, not just in source archives',
		'  - [x] `main.js`',
		'  - [x] `manifest.json`',
		'  - [x] `styles.css`',
		'- [x] GitHub release name matches the exact version number specified in my `manifest.json`',
		`  - [x] Release version: \`${manifest.version}\``,
		'- [x] The `id` in my `manifest.json` matches the `id` in the `community-plugins.json` file',
		`  - [x] Plugin ID: \`${manifest.id}\``,
		'- [x] My `README.md` describes the plugin purpose and provides usage instructions',
		'- [x] I have read the developer policies and assessed this plugin against them',
		'- [x] I have read the plugin guidelines and self-reviewed this plugin for common review issues',
		'- [x] I have added a license in `LICENSE`',
		'- [x] My project respects and is compatible with the original license of any code from other plugins that I am using',
		'',
		'## Local Verification',
		'',
		'```bash',
		'npm ci',
		'npm run verify:all -- --repo ' + repo.replace(/^https:\/\/github\.com\//u, ''),
		'```',
	].join('\n'),
);

function parseArgs(values) {
	const parsed = {
		platforms: [],
		repo: undefined,
	};
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value === '--repo') {
			parsed.repo = values[index + 1];
			index += 1;
		} else if (value?.startsWith('--repo=')) {
			parsed.repo = value.slice('--repo='.length);
		} else if (value === '--platform') {
			parsed.platforms.push(values[index + 1]);
			index += 1;
		} else if (value?.startsWith('--platform=')) {
			parsed.platforms.push(value.slice('--platform='.length));
		} else {
			console.error(`community-pr-body: unknown argument: ${value}`);
			process.exit(1);
		}
	}
	parsed.platforms = parsed.platforms.filter(Boolean);
	return parsed;
}
