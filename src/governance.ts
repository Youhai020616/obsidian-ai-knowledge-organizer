import { ChangeProposal, NoteSnapshot, PatchOperation } from './types';
import { createId, nowIso, slugify, summarizeLocally, tokenize } from './utils';

interface TagStats {
	tag: string;
	count: number;
	paths: string[];
}

export function buildGovernanceProposals(
	notes: NoteSnapshot[],
	existingPaths: Set<string>,
): ChangeProposal[] {
	return [
		buildVaultIndexProposal(notes, existingPaths),
		buildTagGovernanceProposal(notes, existingPaths),
		buildTagRenameProposal(notes),
		...buildDuplicateConsolidationProposals(notes),
		buildDuplicateMergePlanProposal(notes, existingPaths),
	].filter((proposal): proposal is ChangeProposal => proposal !== null);
}

export function buildVaultIndexProposal(
	notes: NoteSnapshot[],
	existingPaths: Set<string>,
): ChangeProposal | null {
	if (notes.length === 0) {
		return null;
	}
	const tagStats = collectTags(notes).slice(0, 20);
	const topicStats = collectTopics(notes).slice(0, 20);
	const path = uniquePath('AI Notes/vault-index.md', existingPaths);
	const content = [
		'---',
		'tags:',
		'  - ai-governance',
		'  - vault-index',
		`generated: ${nowIso()}`,
		'---',
		'',
		'# Vault index',
		'',
		`Generated from ${notes.length} notes. Review before keeping this as a permanent map of content.`,
		'',
		'## Top tags',
		'',
		tagStats.length > 0
			? tagStats
					.map((entry) => `- #${entry.tag} (${entry.count} notes)`)
					.join('\n')
			: '- No tags found.',
		'',
		'## Common topics',
		'',
		topicStats.length > 0
			? topicStats.map((entry) => `- ${entry.term} (${entry.count})`).join('\n')
			: '- No repeated topics found.',
		'',
		'## Notes',
		'',
		...notes
			.slice()
			.sort((a, b) => a.path.localeCompare(b.path))
			.map((note) => `- [[${note.path.replace(/\.md$/u, '')}]]`),
		'',
	].join('\n');

	return createCreateProposal({
		title: 'Create vault index',
		sourcePath: 'vault',
		reason: 'Generate a reviewable map of notes, tags, and common topics.',
		path,
		content,
		summary: 'Create a vault index note.',
		rationale: [
			'Creates a plain Markdown index instead of changing existing notes.',
			'Keeps the governance artifact reviewable and removable.',
		],
	});
}

export function buildTagGovernanceProposal(
	notes: NoteSnapshot[],
	existingPaths: Set<string>,
): ChangeProposal | null {
	const tags = collectTags(notes);
	if (tags.length === 0) {
		return null;
	}
	const nearDuplicates = findNearDuplicateTags(tags.map((entry) => entry.tag));
	const path = uniquePath('AI Notes/tag-governance.md', existingPaths);
	const content = [
		'---',
		'tags:',
		'  - ai-governance',
		'  - tag-governance',
		`generated: ${nowIso()}`,
		'---',
		'',
		'# Tag governance',
		'',
		'Review this report before renaming or merging tags. It does not modify existing notes.',
		'',
		'## Tag inventory',
		'',
		...tags.map((entry) => {
			const paths = entry.paths
				.slice(0, 5)
				.map((pathValue) => `[[${pathValue.replace(/\.md$/u, '')}]]`)
				.join(', ');
			return `- #${entry.tag}: ${entry.count} notes${paths ? ` (${paths})` : ''}`;
		}),
		'',
		'## Possible near-duplicates',
		'',
		nearDuplicates.length > 0
			? nearDuplicates.map((group) => `- ${group.map((tag) => `#${tag}`).join(' / ')}`).join('\n')
			: '- No obvious near-duplicate tags found.',
		'',
	].join('\n');

	return createCreateProposal({
		title: 'Create tag governance report',
		sourcePath: 'vault',
		reason: 'Inventory tags and flag possible near-duplicate tags before any rename work.',
		path,
		content,
		summary: 'Create a tag governance report note.',
		rationale: [
			'Tag cleanup can be destructive; this phase creates a proposal note only.',
			'The report gives users a review point before future batch edits.',
		],
	});
}

export function buildDuplicateMergePlanProposal(
	notes: NoteSnapshot[],
	existingPaths: Set<string>,
): ChangeProposal | null {
	const duplicateGroups = collectDuplicateTitles(notes);
	if (duplicateGroups.length === 0) {
		return null;
	}
	const path = uniquePath('AI Notes/duplicate-merge-plan.md', existingPaths);
	const content = [
		'---',
		'tags:',
		'  - ai-governance',
		'  - duplicate-merge-plan',
		`generated: ${nowIso()}`,
		'---',
		'',
		'# Duplicate merge plan',
		'',
		'This is a review plan, not an automatic merge. Confirm content ownership before moving or deleting notes.',
		'',
		...duplicateGroups.flatMap((group, index) => [
			`## Group ${index + 1}: ${group[0]?.basename ?? 'Duplicate title'}`,
			'',
			...group.map((note) => [
				`### [[${note.path.replace(/\.md$/u, '')}]]`,
				'',
				summarizeLocally(note.content, 2),
				'',
			]).flat(),
			'Recommended next step: choose one canonical note, move unique content into it, then update links.',
			'',
		]),
	].join('\n');

	return createCreateProposal({
		title: 'Create duplicate merge plan',
		sourcePath: 'vault',
		reason: `Found ${duplicateGroups.length} duplicate title group(s).`,
		path,
		content,
		summary: 'Create a duplicate merge planning note.',
		rationale: [
			'Duplicate title cleanup should be human-reviewed before edits.',
			'The proposal preserves all source note paths and summaries.',
		],
	});
}

export function buildDuplicateConsolidationProposals(
	notes: NoteSnapshot[],
): ChangeProposal[] {
	const duplicateGroups = collectDuplicateTitles(notes);
	return duplicateGroups.map((group) => buildDuplicateConsolidationProposal(group));
}

function buildDuplicateConsolidationProposal(group: NoteSnapshot[]): ChangeProposal {
	const sorted = group.slice().sort((a, b) => a.path.localeCompare(b.path));
	const canonical = sorted[0]!;
	const duplicates = sorted.slice(1);
	const operations: PatchOperation[] = [
		{
			id: createId('op'),
			type: 'update',
			path: canonical.path,
			before: canonical.content,
			after: appendDuplicateContent(canonical, duplicates),
			selected: true,
			summary: 'Append duplicate note content to the canonical note.',
		},
		...duplicates.map((duplicate) => ({
			id: createId('op'),
			type: 'update' as const,
			path: duplicate.path,
			before: duplicate.content,
			after: addMergeNotice(duplicate, canonical),
			selected: true,
			summary: 'Add a reviewed duplicate merge notice.',
		})),
	];

	return {
		id: createId('proposal'),
		title: `Consolidate duplicate title: ${canonical.basename}`,
		sourcePath: 'vault',
		createdAt: nowIso(),
		status: 'pending',
		reason: `Prepare a non-destructive consolidation for ${group.length} notes titled "${canonical.basename}".`,
		operations,
		rationale: [
			'The proposal does not delete duplicate notes.',
			'The canonical note receives copied content, and source notes receive a visible merge notice.',
		],
	};
}

export function buildTagRenameProposal(notes: NoteSnapshot[]): ChangeProposal | null {
	const tags = collectTags(notes).map((entry) => entry.tag);
	const groups = findNearDuplicateTags(tags);
	if (groups.length === 0) {
		return null;
	}
	const renameMap = new Map<string, string>();
	for (const group of groups) {
		const canonical = chooseCanonicalTag(group);
		for (const tag of group) {
			if (tag !== canonical) {
				renameMap.set(tag, canonical);
			}
		}
	}

	const operations: PatchOperation[] = [];
	for (const note of notes) {
		const after = replaceTags(note.content, renameMap);
		if (after !== note.content) {
			operations.push({
				id: createId('op'),
				type: 'update',
				path: note.path,
				before: note.content,
				after,
				selected: true,
				summary: 'Normalize near-duplicate tags.',
			});
		}
	}

	if (operations.length === 0) {
		return null;
	}

	return {
		id: createId('proposal'),
		title: 'Normalize near-duplicate tags',
		sourcePath: 'vault',
		createdAt: nowIso(),
		status: 'pending',
		reason: `Normalize ${renameMap.size} tag variant(s) across ${operations.length} note(s).`,
		operations,
		rationale: [
			'Only tag variants with the same normalized slug are proposed.',
			'Every affected file is shown as a separate review operation before writing.',
		],
	};
}

function createCreateProposal(input: {
	title: string;
	sourcePath: string;
	reason: string;
	path: string;
	content: string;
	summary: string;
	rationale: string[];
}): ChangeProposal {
	const operations: PatchOperation[] = [
		{
			id: createId('op'),
			type: 'create',
			path: input.path,
			after: input.content,
			selected: true,
			summary: input.summary,
		},
	];
	return {
		id: createId('proposal'),
		title: input.title,
		sourcePath: input.sourcePath,
		createdAt: nowIso(),
		status: 'pending',
		reason: input.reason,
		operations,
		rationale: input.rationale,
	};
}

function collectTags(notes: NoteSnapshot[]): TagStats[] {
	const map = new Map<string, TagStats>();
	for (const note of notes) {
		for (const tag of extractTags(note.content)) {
			const existing = map.get(tag) ?? { tag, count: 0, paths: [] };
			existing.count += 1;
			if (!existing.paths.includes(note.path)) {
				existing.paths.push(note.path);
			}
			map.set(tag, existing);
		}
	}
	return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function collectTopics(notes: NoteSnapshot[]): Array<{ term: string; count: number }> {
	const counts = new Map<string, number>();
	for (const note of notes) {
		for (const token of tokenize(`${note.basename}\n${note.content}`)) {
			counts.set(token, (counts.get(token) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.filter(([, count]) => count > 1)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([term, count]) => ({ term, count }));
}

function collectDuplicateTitles(notes: NoteSnapshot[]): NoteSnapshot[][] {
	const map = new Map<string, NoteSnapshot[]>();
	for (const note of notes) {
		const key = note.basename.toLowerCase();
		const group = map.get(key) ?? [];
		group.push(note);
		map.set(key, group);
	}
	return [...map.values()]
		.filter((group) => group.length > 1)
		.sort((a, b) => (b.length - a.length) || (a[0]?.basename ?? '').localeCompare(b[0]?.basename ?? ''));
}

function extractTags(markdown: string): string[] {
	const tags = new Set<string>();
	for (const match of markdown.matchAll(/(?:^|\s)#([A-Za-z0-9_\-/\u4e00-\u9fa5]+)/gu)) {
		if (match[1]) {
			tags.add(match[1].toLowerCase());
		}
	}
	const frontmatter = extractFrontmatter(markdown);
	if (!frontmatter) {
		return [...tags];
	}
	const lines = frontmatter.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]?.trim() ?? '';
		if (!line.startsWith('tags:')) {
			continue;
		}
		const inline = line.replace(/^tags:\s*/u, '').trim();
		if (inline.startsWith('[') && inline.endsWith(']')) {
			for (const tag of inline.slice(1, -1).split(',')) {
				const normalized = tag.trim().replace(/^#/u, '').toLowerCase();
				if (normalized) {
					tags.add(normalized);
				}
			}
			continue;
		}
		let cursor = index + 1;
		while (cursor < lines.length) {
			const child = /^\s*-\s+(.+)$/u.exec(lines[cursor] ?? '');
			if (!child) {
				break;
			}
			const normalized = child[1]?.trim().replace(/^#/u, '').toLowerCase();
			if (normalized) {
				tags.add(normalized);
			}
			cursor += 1;
		}
	}
	return [...tags];
}

function extractFrontmatter(markdown: string): string | null {
	if (!markdown.startsWith('---')) {
		return null;
	}
	const end = markdown.indexOf('\n---', 3);
	if (end < 0) {
		return null;
	}
	return markdown.slice(3, end);
}

function findNearDuplicateTags(tags: string[]): string[][] {
	const groups = new Map<string, string[]>();
	for (const tag of tags) {
		const key = slugify(tag).replace(/-/gu, '');
		const group = groups.get(key) ?? [];
		group.push(tag);
		groups.set(key, group);
	}
	return [...groups.values()]
		.map((group) => [...new Set(group)].sort())
		.filter((group) => group.length > 1);
}

function chooseCanonicalTag(group: string[]): string {
	return group
		.slice()
		.sort((a, b) => {
			const hyphenScore = Number(b.includes('-')) - Number(a.includes('-'));
			return hyphenScore || a.length - b.length || a.localeCompare(b);
		})[0] ?? group[0] ?? 'tag';
}

function replaceTags(markdown: string, renameMap: Map<string, string>): string {
	let next = markdown;
	for (const [from, to] of renameMap.entries()) {
		const escaped = escapeRegExp(from);
		next = next
			.replace(new RegExp(`(^|\\s)#${escaped}(?=\\s|$)`, 'giu'), `$1#${to}`)
			.replace(new RegExp(`(^\\s*-\\s*)#?${escaped}(\\s*)$`, 'gimu'), `$1${to}$2`)
			.replace(
				new RegExp(`(tags:\\s*\\[[^\\]]*)#?${escaped}([^\\]]*\\])`, 'giu'),
				`$1${to}$2`,
			);
	}
	return next;
}

function appendDuplicateContent(
	canonical: NoteSnapshot,
	duplicates: NoteSnapshot[],
): string {
	const additions = duplicates
		.map((duplicate) =>
			[
				`### From [[${duplicate.path.replace(/\.md$/u, '')}]]`,
				'',
				truncateDuplicateContent(duplicate.content),
			].join('\n'),
		)
		.join('\n\n');
	return `${canonical.content.trimEnd()}\n\n## Consolidated duplicate notes\n\n${additions}\n`;
}

function addMergeNotice(duplicate: NoteSnapshot, canonical: NoteSnapshot): string {
	if (duplicate.content.includes('AI Knowledge Organizer merge notice')) {
		return duplicate.content;
	}
	return [
		'> [!info] AI Knowledge Organizer merge notice',
		`> Proposed canonical note: [[${canonical.path.replace(/\.md$/u, '')}]]`,
		'> This note was not deleted. Review the canonical note before archiving or removing this duplicate.',
		'',
		duplicate.content,
	].join('\n');
}

function truncateDuplicateContent(markdown: string): string {
	const trimmed = markdown.trim();
	if (trimmed.length <= 4000) {
		return trimmed;
	}
	return `${trimmed.slice(0, 4000)}\n\n[Truncated duplicate content for review.]`;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function uniquePath(path: string, existingPaths: Set<string>): string {
	if (!existingPaths.has(path)) {
		existingPaths.add(path);
		return path;
	}
	const dot = path.lastIndexOf('.');
	const base = dot >= 0 ? path.slice(0, dot) : path;
	const ext = dot >= 0 ? path.slice(dot) : '';
	let counter = 2;
	let candidate = `${base}-${counter}${ext}`;
	while (existingPaths.has(candidate)) {
		counter += 1;
		candidate = `${base}-${counter}${ext}`;
	}
	existingPaths.add(candidate);
	return candidate;
}
