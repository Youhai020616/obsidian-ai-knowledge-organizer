import { describe, expect, it } from 'vitest';
import {
	AnthropicProvider,
	createProvider,
	DeepSeekProvider,
	extractAnthropicText,
	extractChatCompletionText,
	extractGeminiText,
	extractOutputText,
	GeminiProvider,
	HeuristicProvider,
	OllamaProvider,
	OpenAIProvider,
} from '../src/providers';
import { htmlToMarkdown } from '../src/importer';
import { extractPdfText } from '../src/pdf';
import { buildHealthReport } from '../src/health';
import { buildLineDiff, compactDiff, summarizeDiff } from '../src/diff';
import {
	buildGovernanceProposals,
	buildDuplicateConsolidationProposals,
	buildTagRenameProposal,
} from '../src/governance';
import {
	buildSearchIndex,
	rankCandidates,
	rankIndexedCandidates,
} from '../src/retrieval';
import {
	buildProposal,
	mergeFrontmatter,
	scoreNote,
	slugify,
	topKeywords,
} from '../src/utils';
import { DEFAULT_SETTINGS } from '../src/defaults';

describe('utils', () => {
	it('slugifies text into safe paths', () => {
		expect(slugify('Hello, Obsidian AI!')).toBe('hello-obsidian-ai');
		expect(slugify('知识 管理')).toBe('知识-管理');
	});

	it('extracts useful keywords', () => {
		expect(topKeywords('AI notes AI vault review workflow', 2)).toEqual([
			'notes',
			'review',
		]);
	});

	it('merges tags and summary into frontmatter', () => {
		const result = mergeFrontmatter(
			'---\ntags:\n  - existing\nstatus: draft\n---\n\n# Note',
			{
				tags: ['existing', 'ai'],
				ai_summary: 'Short summary',
			},
		);
		expect(result).toContain('status: draft');
		expect(result).toContain('- existing');
		expect(result).toContain('- ai');
		expect(result).toContain('ai_summary: Short summary');
	});

	it('scores notes by query overlap', () => {
		const scored = scoreNote('vault review', {
			path: 'A.md',
			basename: 'Vault Review',
			content: 'This note discusses safe AI writes.',
		});
		expect(scored.score).toBeGreaterThan(0);
		expect(scored.excerpt.length).toBeGreaterThan(0);
	});
});

describe('providers', () => {
	it('creates the expected provider for each configured mode', () => {
		expect(createProvider(DEFAULT_SETTINGS)).toBeInstanceOf(HeuristicProvider);
		expect(
			createProvider({
				...DEFAULT_SETTINGS,
				provider: 'openai',
				openaiApiKey: 'sk-test',
			}),
		).toBeInstanceOf(OpenAIProvider);
		expect(
			createProvider({
				...DEFAULT_SETTINGS,
				provider: 'anthropic',
				anthropicApiKey: 'anthropic-test',
			}),
		).toBeInstanceOf(AnthropicProvider);
		expect(
			createProvider({
				...DEFAULT_SETTINGS,
				provider: 'gemini',
				geminiApiKey: 'gemini-test',
			}),
		).toBeInstanceOf(GeminiProvider);
		expect(
			createProvider({
				...DEFAULT_SETTINGS,
				provider: 'deepseek',
				deepseekApiKey: 'deepseek-test',
			}),
		).toBeInstanceOf(DeepSeekProvider);
		expect(
			createProvider({
				...DEFAULT_SETTINGS,
				provider: 'ollama',
			}),
		).toBeInstanceOf(OllamaProvider);
	});

	it('falls back to local heuristic mode when cloud API keys are missing', () => {
		expect(
			createProvider({
				...DEFAULT_SETTINGS,
				provider: 'openai',
				openaiApiKey: '   ',
			}),
		).toBeInstanceOf(HeuristicProvider);
		expect(
			createProvider({
				...DEFAULT_SETTINGS,
				provider: 'anthropic',
				anthropicApiKey: '',
			}),
		).toBeInstanceOf(HeuristicProvider);
		expect(
			createProvider({
				...DEFAULT_SETTINGS,
				provider: 'gemini',
				geminiApiKey: '',
			}),
		).toBeInstanceOf(HeuristicProvider);
		expect(
			createProvider({
				...DEFAULT_SETTINGS,
				provider: 'deepseek',
				deepseekApiKey: '',
			}),
		).toBeInstanceOf(HeuristicProvider);
	});

	it('extracts output_text from Responses API payloads', () => {
		expect(extractOutputText({ output_text: 'hello' })).toBe('hello');
		expect(
			extractOutputText({
				output: [
					{
						content: [
							{ type: 'output_text', text: 'one' },
							{ type: 'output_text', text: 'two' },
						],
					},
				],
			}),
		).toBe('one\ntwo');
	});

	it('extracts text from Anthropic Messages API payloads', () => {
		expect(
			extractAnthropicText({
				content: [
					{ type: 'text', text: 'one' },
					{ type: 'tool_use', text: 'ignored' },
					{ type: 'text', text: 'two' },
				],
			}),
		).toBe('one\ntwo');
	});

	it('extracts text from Gemini generateContent payloads', () => {
		expect(
			extractGeminiText({
				candidates: [
					{
						content: {
							parts: [{ text: 'one' }, { text: 'two' }],
						},
					},
				],
			}),
		).toBe('one\ntwo');
	});

	it('extracts text from OpenAI-compatible chat completion payloads', () => {
		expect(
			extractChatCompletionText({
				choices: [
					{ message: { content: 'one' } },
					{ message: { content: 'two' } },
				],
			}),
		).toBe('one\ntwo');
	});

	it('generates local analysis without remote egress', async () => {
		const provider = new HeuristicProvider();
		const result = await provider.analyze({
			source: {
				path: 'Inbox/source.md',
				basename: 'source',
				content:
					'# AI Vault Review\n\nAI review workflow keeps vault writes safe. AI review matters.',
			},
			candidates: [
				{
					path: 'Review.md',
					basename: 'Review',
					score: 4,
					excerpt: 'Review queue',
				},
			],
			settings: DEFAULT_SETTINGS,
		});
		expect(result.summary).toContain('AI review workflow');
		expect(result.suggestedLinks).toEqual(['Review']);
		expect(result.newNotes.length).toBeGreaterThan(0);
	});
});

describe('proposal builder', () => {
	it('builds update and create operations', () => {
		const proposal = buildProposal(
			{
				path: 'Inbox/source.md',
				basename: 'source',
				content: '# Source\n\nContent',
			},
			{
				title: 'Organize source',
				summary: 'Summary',
				tags: ['ai'],
				suggestedLinks: ['Other'],
				frontmatter: { status: 'organized' },
				appendSections: [{ heading: 'Follow up', content: 'Check links.' }],
				newNotes: [
					{
						title: 'Extracted Topic',
						path: 'AI Notes/extracted-topic.md',
						content: 'Extracted content.',
						reason: 'Important topic.',
					},
				],
				rationale: ['Useful organization.'],
			},
			new Set(['Inbox/source.md']),
		);
		expect(proposal.operations).toHaveLength(2);
		expect(proposal.operations[0]?.type).toBe('update');
		expect(proposal.operations[1]?.type).toBe('create');
		expect(proposal.operations[0]?.selected).toBe(true);
	});
});

describe('health report', () => {
	it('detects broken links and orphan notes', () => {
		const report = buildHealthReport([
			{
				path: 'A.md',
				basename: 'A',
				content: '---\ntags:\n  - test\n---\n\n[[Missing]]',
			},
			{
				path: 'B.md',
				basename: 'B',
				content: '# B\n\nNo links here.',
			},
		]);
		expect(report.noteCount).toBe(2);
		expect(report.tagCount).toBe(1);
		expect(report.issues.some((issue) => issue.type === 'broken-link')).toBe(
			true,
		);
		expect(report.issues.some((issue) => issue.type === 'orphan')).toBe(true);
		expect(
			report.issues.some((issue) => issue.type === 'missing-frontmatter'),
		).toBe(true);
	});
});

describe('diff', () => {
	it('builds compact unified line diffs', () => {
		const diff = compactDiff(buildLineDiff('a\nb\nc', 'a\nB\nc\nd'), 1);
		const summary = summarizeDiff(diff);
		expect(summary.added).toBe(2);
		expect(summary.removed).toBe(1);
		expect(diff.some((line) => line.type === 'add' && line.text === 'B')).toBe(
			true,
		);
	});
});

describe('governance proposals', () => {
	it('creates index, tag, and duplicate merge proposals when supported by vault content', () => {
		const proposals = buildGovernanceProposals(
			[
				{
					path: 'Projects/A.md',
					basename: 'A',
					content: '---\ntags:\n  - AI\n---\n\n# A\n\nAI workflow content.',
				},
				{
					path: 'Archive/A.md',
					basename: 'A',
					content: '# A\n\n#ai duplicate content.',
				},
			],
			new Set(['Projects/A.md', 'Archive/A.md']),
		);
		expect(proposals.map((proposal) => proposal.title)).toContain(
			'Create vault index',
		);
		expect(proposals.map((proposal) => proposal.title)).toContain(
			'Create tag governance report',
		);
		expect(proposals.map((proposal) => proposal.title)).toContain(
			'Create duplicate merge plan',
		);
		expect(proposals.every((proposal) => proposal.status === 'pending')).toBe(
			true,
		);
	});

	it('creates direct tag rename operations for near-duplicate tags', () => {
		const proposal = buildTagRenameProposal([
			{
				path: 'A.md',
				basename: 'A',
				content: '# A\n\n#machinelearning',
			},
			{
				path: 'B.md',
				basename: 'B',
				content: '# B\n\n#machine-learning',
			},
		]);
		expect(proposal?.title).toBe('Normalize near-duplicate tags');
		expect(proposal?.operations).toHaveLength(1);
		expect(proposal?.operations[0]?.type).toBe('update');
	});

	it('creates non-destructive duplicate consolidation proposals', () => {
		const proposals = buildDuplicateConsolidationProposals([
			{
				path: 'A.md',
				basename: 'Topic',
				content: '# Topic\n\nCanonical.',
			},
			{
				path: 'Folder/A.md',
				basename: 'Topic',
				content: '# Topic\n\nDuplicate details.',
			},
		]);
		expect(proposals).toHaveLength(1);
		expect(proposals[0]?.operations).toHaveLength(2);
		expect(proposals[0]?.operations[0]?.type).toBe('update');
		expect(proposals[0]?.operations[1]?.type).toBe('update');
		expect(proposals[0]?.operations[1]?.summary).toContain('merge notice');
	});
});

describe('retrieval', () => {
	it('ranks title and body matches above unrelated notes', () => {
		const results = rankCandidates(
			'ai review workflow',
			[
				{
					path: 'A.md',
					basename: 'AI review',
					content: 'Workflow and safe writes.',
				},
				{
					path: 'B.md',
					basename: 'Cooking',
					content: 'Recipes and pantry notes.',
				},
			],
			{ limit: 5 },
		);
		expect(results[0]?.path).toBe('A.md');
		expect(results).toHaveLength(1);
	});

	it('queries the persisted search index', () => {
		const index = buildSearchIndex([
			{
				path: 'A.md',
				basename: 'AI review',
				content: 'Workflow and safe writes.',
			},
			{
				path: 'B.md',
				basename: 'Cooking',
				content: 'Recipes and pantry notes.',
			},
		]);
		const results = rankIndexedCandidates('safe workflow', index, { limit: 3 });
		expect(index.noteCount).toBe(2);
		expect(results[0]?.path).toBe('A.md');
	});
});

describe('imports', () => {
	it('extracts readable article content from noisy HTML', () => {
		const markdown = htmlToMarkdown(`
			<html>
				<body>
					<nav><a href="/home">Home</a></nav>
					<article>
						<h1>Useful Page</h1>
						<p>Important vault workflow content.</p>
						<p>Read the <a href="https://example.com/ref">reference</a>.</p>
					</article>
					<footer>Legal text</footer>
				</body>
			</html>
		`);
		expect(markdown).toContain('# Useful Page');
		expect(markdown).toContain('Important vault workflow content.');
		expect(markdown).toContain('reference (https://example.com/ref)');
		expect(markdown).not.toContain('Home');
		expect(markdown).not.toContain('Legal text');
	});

	it('extracts basic selectable text from PDF content streams', () => {
		const pdf = [
			'%PDF-1.4',
			'BT',
			'(Hello\\040vault) Tj',
			'<776f726b666c6f77> Tj',
			'[(AI) 120 (review)] TJ',
			'ET',
		].join('\n');
		const text = extractPdfText(toArrayBuffer(pdf));
		expect(text).toContain('Hello vault');
		expect(text).toContain('workflow');
		expect(text).toContain('AI review');
	});
});

function toArrayBuffer(value: string): ArrayBuffer {
	const bytes = new TextEncoder().encode(value);
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
