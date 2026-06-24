import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import process from 'node:process';

const ignoredDirs = new Set([
	'.git',
	'.tmp',
	'dist',
	'node_modules',
]);
const failures = [];

for (const file of findMarkdownFiles('.')) {
	const content = readFileSync(file, 'utf8');
	for (const link of extractMarkdownLinks(content)) {
		if (shouldSkipLink(link)) {
			continue;
		}
		const [pathPart] = link.split('#');
		if (!pathPart) {
			continue;
		}
		const decodedPath = decodeURIComponent(pathPart);
		const target = normalize(join(dirname(file), decodedPath));
		if (!existsSync(target)) {
			failures.push(`${file}: broken link target ${link}`);
		}
	}
}

if (failures.length > 0) {
	for (const failure of failures) {
		console.error(`docs-check: ${failure}`);
	}
	process.exit(1);
}

console.log('docs-check: markdown links are valid.');

function findMarkdownFiles(root) {
	const results = [];
	visit(root);
	return results.sort();

	function visit(directory) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (ignoredDirs.has(entry.name)) {
				continue;
			}
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(path);
			} else if (entry.isFile() && entry.name.endsWith('.md')) {
				results.push(path);
			}
		}
	}
}

function extractMarkdownLinks(content) {
	const links = [];
	const pattern = /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
	for (const match of content.matchAll(pattern)) {
		const link = match[1];
		if (link) {
			links.push(link.trim());
		}
	}
	return links;
}

function shouldSkipLink(link) {
	return (
		link.startsWith('#') ||
		/^[a-z][a-z0-9+.-]*:/iu.test(link)
	);
}
