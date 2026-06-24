import {
	AnalysisResult,
	AppendSection,
	CandidateNote,
	ChangeProposal,
	NewNoteSuggestion,
	NoteSnapshot,
	PatchOperation,
} from './types';

const STOP_WORDS = new Set([
	'the',
	'and',
	'for',
	'with',
	'that',
	'this',
	'from',
	'are',
	'you',
	'your',
	'have',
	'not',
	'but',
	'was',
	'were',
	'will',
	'can',
	'into',
	'about',
	'what',
	'when',
	'where',
	'which',
	'then',
	'than',
	'also',
	'there',
	'their',
	'我们的',
	'一个',
	'这个',
	'那个',
	'以及',
	'可以',
	'进行',
	'如果',
	'因为',
]);

export function nowIso(): string {
	return new Date().toISOString();
}

export function createId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
}

export function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	return `${text.slice(0, Math.max(0, maxChars - 120))}\n\n[Truncated by AI Knowledge Organizer to fit the configured context limit.]`;
}

export function stripMarkdown(markdown: string): string {
	return markdown
		.replace(/^---[\s\S]*?---\s*/u, '')
		.replace(/```[\s\S]*?```/gu, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
		.replace(/\[[^\]]*\]\([^)]*\)/gu, ' ')
		.replace(/\[|\]|[#>*_`~-]/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim();
}

export function summarizeLocally(markdown: string, maxSentences = 2): string {
	const plain = stripMarkdown(markdown);
	if (!plain) {
		return 'No readable content found.';
	}
	const sentences =
		plain
			.match(/[^.!?。！？]+[.!?。！？]?/gu)
			?.map((sentence) => sentence.trim())
			.filter(Boolean) ?? [];
	if (sentences.length === 0) {
		return plain.slice(0, 240);
	}
	return sentences.slice(0, maxSentences).join(' ').slice(0, 500);
}

export function tokenize(text: string): string[] {
	const matches = text
		.toLowerCase()
		.match(/[\p{Script=Han}]{2,}|[a-z0-9][a-z0-9-]{2,}/gu);
	if (!matches) {
		return [];
	}
	return matches.filter((token) => !STOP_WORDS.has(token));
}

export function topKeywords(text: string, limit = 8): string[] {
	const counts = new Map<string, number>();
	for (const token of tokenize(text)) {
		counts.set(token, (counts.get(token) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, limit)
		.map(([token]) => token);
}

export function slugify(input: string): string {
	const slug = input
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		.slice(0, 80);
	return slug || 'untitled';
}

export function scoreNote(query: string, note: NoteSnapshot): CandidateNote {
	const queryTokens = new Set(tokenize(query));
	const haystack = `${note.basename} ${note.content}`.toLowerCase();
	let score = 0;
	for (const token of queryTokens) {
		if (haystack.includes(token)) {
			score += note.basename.toLowerCase().includes(token) ? 5 : 1;
		}
	}
	const firstHit = [...queryTokens].find((token) => haystack.includes(token));
	const excerpt = buildExcerpt(note.content, firstHit);
	return {
		path: note.path,
		basename: note.basename,
		score,
		excerpt,
	};
}

export function buildExcerpt(markdown: string, token?: string): string {
	const plain = stripMarkdown(markdown);
	if (!plain) {
		return '';
	}
	if (!token) {
		return plain.slice(0, 260);
	}
	const index = plain.toLowerCase().indexOf(token.toLowerCase());
	if (index < 0) {
		return plain.slice(0, 260);
	}
	const start = Math.max(0, index - 110);
	const end = Math.min(plain.length, index + 170);
	return `${start > 0 ? '...' : ''}${plain.slice(start, end)}${
		end < plain.length ? '...' : ''
	}`;
}

export function uniqueStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const rawValue of values) {
		const value = rawValue.trim();
		if (!value || seen.has(value.toLowerCase())) {
			continue;
		}
		seen.add(value.toLowerCase());
		result.push(value);
	}
	return result;
}

export function mergeFrontmatter(
	markdown: string,
	fields: Record<string, string | string[]>,
): string {
	const { frontmatter, body } = splitFrontmatter(markdown);
	const existing = parseSimpleYaml(frontmatter);
	const merged = new Map(existing);

	for (const [key, value] of Object.entries(fields)) {
		if (key === 'tags') {
			const existingTags = yamlValueToArray(merged.get('tags'));
			const nextTags = Array.isArray(value) ? value : [value];
			merged.set('tags', uniqueStrings([...existingTags, ...nextTags]));
		} else {
			merged.set(key, value);
		}
	}

	return `---\n${formatSimpleYaml(merged)}---\n\n${body.trimStart()}`;
}

export function appendSections(markdown: string, sections: AppendSection[]): string {
	const additions = sections
		.filter((section) => section.heading.trim() && section.content.trim())
		.map((section) => `## ${section.heading.trim()}\n\n${section.content.trim()}`)
		.join('\n\n');
	if (!additions) {
		return markdown;
	}
	return `${markdown.trimEnd()}\n\n${additions}\n`;
}

export function buildProposal(
	source: NoteSnapshot,
	analysis: AnalysisResult,
	existingPaths: Set<string>,
): ChangeProposal {
	let after = mergeFrontmatter(source.content, {
		...analysis.frontmatter,
		tags: analysis.tags,
		ai_summary: analysis.summary,
	});
	after = appendSections(after, [
		{
			heading: 'AI Organization Notes',
			content: buildOrganizationSection(analysis),
		},
		...analysis.appendSections,
	]);

	const operations: PatchOperation[] = [
		{
			id: createId('op'),
			type: 'update',
			path: source.path,
			before: source.content,
			after,
			selected: true,
			summary: 'Update frontmatter and append AI organization notes.',
		},
	];

	for (const note of analysis.newNotes) {
		const path = ensureUniquePath(
			note.path ?? `AI Notes/${slugify(note.title)}.md`,
			existingPaths,
		);
		existingPaths.add(path);
		operations.push({
			id: createId('op'),
			type: 'create',
			path,
			after: formatNewNote(note, source.path),
			selected: true,
			summary: note.reason || `Create extracted note: ${note.title}`,
		});
	}

	return {
		id: createId('proposal'),
		title: analysis.title || `Organize ${source.basename}`,
		sourcePath: source.path,
		createdAt: nowIso(),
		status: 'pending',
		reason: analysis.summary,
		operations,
		rationale: analysis.rationale,
	};
}

export function selectedOperations(proposal: ChangeProposal): PatchOperation[] {
	return proposal.operations.filter((operation) => operation.selected);
}

export function setOperationSelected(
	proposal: ChangeProposal,
	operationId: string,
	selected: boolean,
): ChangeProposal {
	return {
		...proposal,
		operations: proposal.operations.map((operation) =>
			operation.id === operationId ? { ...operation, selected } : operation,
		),
	};
}

const SECRET_LABEL =
	'password|passwd|pwd|secret|token|api[\\s_-]?key|access[\\s_-]?key|private[\\s_-]?key|密码|口令|密钥|令牌';

const LABELED_SECRET = new RegExp(`(${SECRET_LABEL})(\\s*[:：=]\\s*).+`, 'gi');

const SECRET_TOKEN_PATTERNS: RegExp[] = [
	/\bsk-?\s?[A-Za-z0-9]{12,}\b/gi,
	/\bghp_[A-Za-z0-9]{20,}\b/g,
	/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
];

/**
 * Best-effort redaction of secrets (API keys, passwords, tokens) before note
 * content is shown in answers or sent to a cloud provider. Token patterns run
 * first so a labelled replacement cannot truncate them. This reduces accidental
 * exposure; it is not a substitute for keeping credentials out of the vault.
 */
export function redactSecrets(text: string): string {
	if (!text) {
		return text;
	}
	let out = text;
	for (const pattern of SECRET_TOKEN_PATTERNS) {
		out = out.replace(pattern, '[REDACTED]');
	}
	out = out.replace(
		LABELED_SECRET,
		(_match, label: string, separator: string) =>
			`${label}${separator}[REDACTED]`,
	);
	return out;
}

function splitFrontmatter(markdown: string): {
	frontmatter: string;
	body: string;
} {
	if (!markdown.startsWith('---')) {
		return { frontmatter: '', body: markdown };
	}
	const end = markdown.indexOf('\n---', 3);
	if (end < 0) {
		return { frontmatter: '', body: markdown };
	}
	return {
		frontmatter: markdown.slice(3, end).trim(),
		body: markdown.slice(end + 4).trimStart(),
	};
}

function parseSimpleYaml(frontmatter: string): Map<string, string | string[]> {
	const map = new Map<string, string | string[]>();
	const lines = frontmatter.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]?.trimEnd() ?? '';
		if (!line.trim() || line.trim().startsWith('#')) {
			continue;
		}
		const match = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line);
		if (!match) {
			continue;
		}
		const key = match[1] ?? '';
		const value = match[2] ?? '';
		if (!key) {
			continue;
		}
		if (value) {
			map.set(key, unquoteYaml(value));
			continue;
		}
		const array: string[] = [];
		let cursor = index + 1;
		while (cursor < lines.length) {
			const child = lines[cursor] ?? '';
			const childMatch = /^\s*-\s+(.+)$/u.exec(child);
			if (!childMatch) {
				break;
			}
			array.push(unquoteYaml(childMatch[1] ?? ''));
			cursor += 1;
		}
		if (array.length > 0) {
			map.set(key, array);
			index = cursor - 1;
		}
	}
	return map;
}

function formatSimpleYaml(map: Map<string, string | string[]>): string {
	let output = '';
	for (const [key, value] of map.entries()) {
		if (Array.isArray(value)) {
			output += `${key}:\n`;
			for (const item of value) {
				output += `  - ${quoteYaml(item)}\n`;
			}
		} else {
			output += `${key}: ${quoteYaml(value)}\n`;
		}
	}
	return output;
}

function yamlValueToArray(value: string | string[] | undefined): string[] {
	if (!value) {
		return [];
	}
	if (Array.isArray(value)) {
		return value;
	}
	return value
		.replace(/^\[|\]$/gu, '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

function quoteYaml(value: string): string {
	if (/^[A-Za-z0-9_\-/\u4e00-\u9fa5 ]+$/u.test(value)) {
		return value;
	}
	return JSON.stringify(value);
}

function unquoteYaml(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function buildOrganizationSection(analysis: AnalysisResult): string {
	const links = analysis.suggestedLinks
		.map((link) => `- [[${link.replace(/\.md$/u, '')}]]`)
		.join('\n');
	const tags = analysis.tags.map((tag) => `#${tag.replace(/^#/u, '')}`).join(' ');
	const rationale = analysis.rationale.map((item) => `- ${item}`).join('\n');
	return [
		`Summary: ${analysis.summary}`,
		tags ? `Tags: ${tags}` : '',
		links ? `Suggested links:\n${links}` : '',
		rationale ? `Rationale:\n${rationale}` : '',
	]
		.filter(Boolean)
		.join('\n\n');
}

function formatNewNote(note: NewNoteSuggestion, sourcePath: string): string {
	return `---\nsource: [[${sourcePath.replace(/\.md$/u, '')}]]\ntags:\n  - ai-extracted\n---\n\n# ${note.title}\n\n${note.content.trim()}\n\n## Source\n\nDerived from [[${sourcePath.replace(/\.md$/u, '')}]].\n`;
}

function ensureUniquePath(path: string, existingPaths: Set<string>): string {
	const normalized = path.endsWith('.md') ? path : `${path}.md`;
	if (!existingPaths.has(normalized)) {
		return normalized;
	}
	const dot = normalized.lastIndexOf('.');
	const base = dot >= 0 ? normalized.slice(0, dot) : normalized;
	const ext = dot >= 0 ? normalized.slice(dot) : '';
	let counter = 2;
	let candidate = `${base}-${counter}${ext}`;
	while (existingPaths.has(candidate)) {
		counter += 1;
		candidate = `${base}-${counter}${ext}`;
	}
	return candidate;
}
