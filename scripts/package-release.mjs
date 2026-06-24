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

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const pluginId = manifest.id;
const version = manifest.version;
const releaseFiles = ['manifest.json', 'main.js', 'styles.css'];
const outputDir = join('dist', 'release', `${pluginId}-${version}`);
const failures = [];

if (version !== packageJson.version) {
	failures.push(
		`manifest version ${version} does not match package version ${packageJson.version}`,
	);
}

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
		console.error(`package-release: ${failure}`);
	}
	process.exit(1);
}

rmSync(outputDir, { force: true, recursive: true });
mkdirSync(outputDir, { recursive: true });

for (const file of releaseFiles) {
	cpSync(file, join(outputDir, file));
}

console.log(`package-release: prepared ${outputDir}`);
console.log(`package-release: files: ${releaseFiles.join(', ')}`);
