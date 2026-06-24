import { HealthIssue, HealthReport, NoteSnapshot } from './types';
import { createId, nowIso } from './utils';

const WIKI_LINK_PATTERN = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/gu;
const TAG_PATTERN = /(?:^|\s)#([A-Za-z0-9_\-/\u4e00-\u9fa5]+)/gu;

export function buildHealthReport(notes: NoteSnapshot[]): HealthReport {
	const issues: HealthIssue[] = [];
	const pathByBasename = new Map<string, string[]>();
	const existingNames = new Set<string>();
	const inboundCounts = new Map<string, number>();
	const tags = new Set<string>();
	let linkCount = 0;

	for (const note of notes) {
		existingNames.add(note.basename.toLowerCase());
		inboundCounts.set(note.path, 0);
		const paths = pathByBasename.get(note.basename.toLowerCase()) ?? [];
		paths.push(note.path);
		pathByBasename.set(note.basename.toLowerCase(), paths);
	}

	for (const note of notes) {
		if (!note.content.trimStart().startsWith('---')) {
			issues.push({
				id: createId('health'),
				type: 'missing-frontmatter',
				severity: 'low',
				path: note.path,
				message: 'Note has no YAML frontmatter for metadata governance.',
			});
		}

		for (const tagMatch of note.content.matchAll(TAG_PATTERN)) {
			const tag = tagMatch[1];
			if (tag) {
				tags.add(tag.toLowerCase());
			}
		}
		for (const tag of extractFrontmatterTags(note.content)) {
			tags.add(tag.toLowerCase());
		}

		for (const linkMatch of note.content.matchAll(WIKI_LINK_PATTERN)) {
			const target = linkMatch[1]?.trim();
			if (!target) {
				continue;
			}
			linkCount += 1;
			const targetName = target.split('/').pop()?.replace(/\.md$/u, '') ?? target;
			if (!existingNames.has(targetName.toLowerCase())) {
				issues.push({
					id: createId('health'),
					type: 'broken-link',
					severity: 'high',
					path: note.path,
					message: `Broken wikilink target: ${target}`,
				});
				continue;
			}
			for (const targetPath of pathByBasename.get(targetName.toLowerCase()) ?? []) {
				inboundCounts.set(targetPath, (inboundCounts.get(targetPath) ?? 0) + 1);
			}
		}
	}

	for (const [basename, paths] of pathByBasename.entries()) {
		if (paths.length > 1) {
			for (const path of paths) {
				issues.push({
					id: createId('health'),
					type: 'duplicate-title',
					severity: 'medium',
					path,
					message: `Duplicate note title: ${basename}`,
					relatedPaths: paths.filter((relatedPath) => relatedPath !== path),
				});
			}
		}
	}

	for (const note of notes) {
		const inbound = inboundCounts.get(note.path) ?? 0;
		const hasOutgoing = [...note.content.matchAll(WIKI_LINK_PATTERN)].length > 0;
		if (inbound === 0 && !hasOutgoing) {
			issues.push({
				id: createId('health'),
				type: 'orphan',
				severity: 'medium',
				path: note.path,
				message: 'Note has no incoming or outgoing wikilinks.',
			});
		}
	}

	return {
		id: createId('health-report'),
		createdAt: nowIso(),
		noteCount: notes.length,
		tagCount: tags.size,
		linkCount,
		issues: sortIssues(issues),
	};
}

function sortIssues(issues: HealthIssue[]): HealthIssue[] {
	const severityScore = { high: 3, medium: 2, low: 1 };
	return issues.sort(
		(a, b) =>
			severityScore[b.severity] - severityScore[a.severity] ||
			a.path.localeCompare(b.path),
	);
}

function extractFrontmatterTags(markdown: string): string[] {
	if (!markdown.startsWith('---')) {
		return [];
	}
	const end = markdown.indexOf('\n---', 3);
	if (end < 0) {
		return [];
	}
	const frontmatter = markdown.slice(3, end);
	const lines = frontmatter.split('\n');
	const tags: string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]?.trim() ?? '';
		if (line.startsWith('tags:')) {
			const inline = line.replace(/^tags:\s*/u, '').trim();
			if (inline.startsWith('[') && inline.endsWith(']')) {
				tags.push(
					...inline
						.slice(1, -1)
						.split(',')
						.map((tag) => tag.trim())
						.filter(Boolean),
				);
				continue;
			}
			let cursor = index + 1;
			while (cursor < lines.length) {
				const child = /^\s*-\s+(.+)$/u.exec(lines[cursor] ?? '');
				if (!child) {
					break;
				}
				if (child[1]) {
					tags.push(child[1].trim());
				}
				cursor += 1;
			}
		}
	}
	return tags;
}
