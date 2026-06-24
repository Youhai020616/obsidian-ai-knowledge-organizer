import { requestUrl } from 'obsidian';
import {
	AnalysisInput,
	AnalysisResult,
	CandidateNote,
	ChatTurn,
	Provider,
	ProviderId,
} from './types';
import {
	slugify,
	summarizeLocally,
	topKeywords,
	truncateText,
	uniqueStrings,
} from './utils';

const ANALYSIS_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: [
		'title',
		'summary',
		'tags',
		'suggestedLinks',
		'frontmatter',
		'appendSections',
		'newNotes',
		'rationale',
	],
	properties: {
		title: { type: 'string' },
		summary: { type: 'string' },
		tags: { type: 'array', items: { type: 'string' } },
		suggestedLinks: { type: 'array', items: { type: 'string' } },
		frontmatter: {
			type: 'object',
			additionalProperties: {
				anyOf: [
					{ type: 'string' },
					{ type: 'array', items: { type: 'string' } },
				],
			},
		},
		appendSections: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['heading', 'content'],
				properties: {
					heading: { type: 'string' },
					content: { type: 'string' },
				},
			},
		},
		newNotes: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['title', 'path', 'content', 'reason'],
				properties: {
					title: { type: 'string' },
					path: { type: 'string' },
					content: { type: 'string' },
					reason: { type: 'string' },
				},
			},
		},
		rationale: { type: 'array', items: { type: 'string' } },
	},
};

export function createProvider(settings: {
	provider: ProviderId;
	openaiApiKey: string;
	openaiModel: string;
	anthropicApiKey: string;
	anthropicModel: string;
	geminiApiKey: string;
	geminiModel: string;
	deepseekApiKey: string;
	deepseekModel: string;
	deepseekBaseUrl: string;
	ollamaUrl: string;
	ollamaModel: string;
}): Provider {
	if (settings.provider === 'openai' && settings.openaiApiKey.trim()) {
		return new OpenAIProvider(settings.openaiApiKey.trim(), settings.openaiModel);
	}
	if (settings.provider === 'anthropic' && settings.anthropicApiKey.trim()) {
		return new AnthropicProvider(
			settings.anthropicApiKey.trim(),
			settings.anthropicModel,
		);
	}
	if (settings.provider === 'gemini' && settings.geminiApiKey.trim()) {
		return new GeminiProvider(settings.geminiApiKey.trim(), settings.geminiModel);
	}
	if (settings.provider === 'deepseek' && settings.deepseekApiKey.trim()) {
		return new DeepSeekProvider(
			settings.deepseekApiKey.trim(),
			settings.deepseekModel,
			settings.deepseekBaseUrl,
		);
	}
	if (settings.provider === 'ollama') {
		return new OllamaProvider(settings.ollamaUrl, settings.ollamaModel);
	}
	return new HeuristicProvider();
}

export class HeuristicProvider implements Provider {
	async analyze(input: AnalysisInput): Promise<AnalysisResult> {
		const keywords = topKeywords(input.source.content, 6);
		const summary = summarizeLocally(input.source.content, 2);
		const links = input.candidates
			.filter((candidate) => candidate.score > 0)
			.slice(0, 5)
			.map((candidate) => candidate.basename);
		const tags = uniqueStrings(
			keywords
				.filter((keyword) => keyword.length <= 32)
				.slice(0, 5)
				.map((keyword) => slugify(keyword)),
		);

		const newNotes = keywords.slice(0, 2).map((keyword) => ({
			title: titleCase(keyword),
			path: `AI Notes/${slugify(keyword)}.md`,
			content: `This extracted note tracks the topic "${keyword}" from [[${input.source.basename}]].\n\n${summary}`,
			reason: `Keyword "${keyword}" appears important in the source note.`,
		}));

		return {
			title: `Organize ${input.source.basename}`,
			summary,
			tags,
			suggestedLinks: links,
			frontmatter: {
				status: 'organized',
			},
			appendSections: [
				{
					heading: 'Next Review',
					content:
						'Review this AI-generated organization note, keep useful links, and remove anything that does not match your intent.',
				},
			],
			newNotes,
			rationale: [
				'Generated locally without sending note content to a remote model.',
				'Used repeated terms and existing note names to recommend tags and links.',
			],
		};
	}

	async answer(question: string, candidates: CandidateNote[]): Promise<string> {
		const modeNote =
			'_Local mode: I search your vault and quote matches rather than writing an answer. Pick a model from the ⚡ menu below for synthesized replies._';
		if (candidates.length === 0) {
			return `I searched your vault but didn't find notes matching "${question}".\n\nTry different keywords, or set the scope to **Active note** to ask about the note you're viewing.\n\n${modeNote}`;
		}
		const lines = candidates
			.slice(0, 5)
			.map(
				(candidate) =>
					`- **${candidate.basename}** — ${candidate.excerpt || 'No excerpt available.'}`,
			)
			.join('\n');
		return `Here are the most relevant notes for "${question}":\n\n${lines}\n\n${modeNote}`;
	}
}

export class OpenAIProvider implements Provider {
	constructor(
		private readonly apiKey: string,
		private readonly model: string,
	) {}

	async analyze(input: AnalysisInput): Promise<AnalysisResult> {
		const responseText = await this.createResponse({
			instructions:
				'You are an Obsidian knowledge organization assistant. Return compact, conservative JSON. Do not invent facts. Propose tags, links, and optional extracted notes only when supported by the source.',
			input: [
				`Source path: ${input.source.path}`,
				`Source note:\n${truncateText(
					input.source.content,
					input.settings.maxContextChars,
				)}`,
				`Candidate existing notes:\n${input.candidates
					.slice(0, 12)
					.map(
						(candidate) =>
							`- ${candidate.basename} (${candidate.path}): ${candidate.excerpt}`,
					)
					.join('\n')}`,
				'Return JSON for an Obsidian review proposal. Use suggestedLinks values that match existing note basenames when possible.',
			].join('\n\n'),
			textFormat: {
				type: 'json_schema',
				name: 'vault_analysis',
				strict: true,
				schema: ANALYSIS_SCHEMA,
			},
		});
		return normalizeAnalysis(JSON.parse(responseText) as Partial<AnalysisResult>);
	}

	async answer(
		question: string,
		candidates: CandidateNote[],
		history?: ChatTurn[],
	): Promise<string> {
		return this.createResponse({
			instructions:
				'Answer from the provided Obsidian notes only. Cite note basenames inline. If the notes do not contain enough evidence, say so clearly. Use the earlier conversation for context when relevant.',
			input: buildAnswerPrompt(question, candidates, history),
		});
	}

	private async createResponse(request: {
		instructions: string;
		input: string;
		textFormat?: unknown;
	}): Promise<string> {
		const response = await requestUrl({
			url: 'https://api.openai.com/v1/responses',
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
			},
			contentType: 'application/json',
			throw: false,
			body: JSON.stringify({
				model: this.model,
				instructions: request.instructions,
				input: request.input,
				text: request.textFormat ? { format: request.textFormat } : undefined,
			}),
		});

		if (response.status >= 400) {
			throw new Error(`OpenAI request failed (${response.status}): ${response.text}`);
		}

		const payload = response.json as {
			output_text?: string;
			output?: Array<{
				type?: string;
				content?: Array<{ type?: string; text?: string }>;
			}>;
		};
		const text = extractOutputText(payload);
		if (!text.trim()) {
			throw new Error('OpenAI response did not include text output.');
		}
		return text.trim();
	}
}

export class AnthropicProvider implements Provider {
	constructor(
		private readonly apiKey: string,
		private readonly model: string,
	) {}

	async analyze(input: AnalysisInput): Promise<AnalysisResult> {
		const text = await this.createMessage({
			system:
				'You are an Obsidian knowledge organization assistant. Return compact, conservative JSON. Do not invent facts.',
			prompt: buildJsonAnalysisPrompt(input),
		});
		return normalizeAnalysis(JSON.parse(extractFirstJson(text)) as Partial<AnalysisResult>);
	}

	async answer(
		question: string,
		candidates: CandidateNote[],
		history?: ChatTurn[],
	): Promise<string> {
		return this.createMessage({
			system:
				'Answer from the provided Obsidian notes only. Cite note basenames inline. If the notes do not contain enough evidence, say so clearly. Use the earlier conversation for context when relevant.',
			prompt: buildAnswerPrompt(question, candidates, history),
		});
	}

	private async createMessage(request: {
		system: string;
		prompt: string;
	}): Promise<string> {
		const response = await requestUrl({
			url: 'https://api.anthropic.com/v1/messages',
			method: 'POST',
			headers: {
				'x-api-key': this.apiKey,
				'anthropic-version': '2023-06-01',
			},
			contentType: 'application/json',
			throw: false,
			body: JSON.stringify({
				model: this.model,
				max_tokens: 2048,
				system: request.system,
				messages: [{ role: 'user', content: request.prompt }],
			}),
		});
		if (response.status >= 400) {
			throw new Error(
				`Anthropic request failed (${response.status}): ${response.text}`,
			);
		}
		const text = extractAnthropicText(
			response.json as {
				content?: Array<{ type?: string; text?: string }>;
			},
		);
		if (!text.trim()) {
			throw new Error('Anthropic response did not include text output.');
		}
		return text.trim();
	}
}

export class GeminiProvider implements Provider {
	constructor(
		private readonly apiKey: string,
		private readonly model: string,
	) {}

	async analyze(input: AnalysisInput): Promise<AnalysisResult> {
		const text = await this.generateContent(buildJsonAnalysisPrompt(input), {
			responseMimeType: 'application/json',
		});
		return normalizeAnalysis(JSON.parse(extractFirstJson(text)) as Partial<AnalysisResult>);
	}

	async answer(
		question: string,
		candidates: CandidateNote[],
		history?: ChatTurn[],
	): Promise<string> {
		return this.generateContent(
			buildAnswerPrompt(question, candidates, history),
		);
	}

	private async generateContent(
		prompt: string,
		options: { responseMimeType?: string } = {},
	): Promise<string> {
		const modelPath = normalizeGeminiModelPath(this.model);
		const response = await requestUrl({
			url: `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${encodeURIComponent(
				this.apiKey,
			)}`,
			method: 'POST',
			contentType: 'application/json',
			throw: false,
			body: JSON.stringify({
				contents: [{ parts: [{ text: prompt }] }],
				generationConfig: {
					maxOutputTokens: 2048,
					responseMimeType: options.responseMimeType,
				},
			}),
		});
		if (response.status >= 400) {
			throw new Error(`Gemini request failed (${response.status}): ${response.text}`);
		}
		const text = extractGeminiText(
			response.json as {
				candidates?: Array<{
					content?: { parts?: Array<{ text?: string }> };
				}>;
			},
		);
		if (!text.trim()) {
			throw new Error('Gemini response did not include text output.');
		}
		return text.trim();
	}
}

export class DeepSeekProvider implements Provider {
	constructor(
		private readonly apiKey: string,
		private readonly model: string,
		private readonly baseUrl: string,
	) {}

	async analyze(input: AnalysisInput): Promise<AnalysisResult> {
		const text = await this.createChatCompletion({
			system:
				'You are an Obsidian knowledge organization assistant. Return compact, conservative JSON. Do not invent facts.',
			prompt: buildJsonAnalysisPrompt(input),
			responseFormat: { type: 'json_object' },
		});
		return normalizeAnalysis(JSON.parse(extractFirstJson(text)) as Partial<AnalysisResult>);
	}

	async answer(
		question: string,
		candidates: CandidateNote[],
		history?: ChatTurn[],
	): Promise<string> {
		return this.createChatCompletion({
			system:
				'Answer from the provided Obsidian notes only. Cite note basenames inline. If the notes do not contain enough evidence, say so clearly. Use the earlier conversation for context when relevant.',
			prompt: buildAnswerPrompt(question, candidates, history),
		});
	}

	private async createChatCompletion(request: {
		system: string;
		prompt: string;
		responseFormat?: { type: 'json_object' | 'text' };
	}): Promise<string> {
		const response = await requestUrl({
			url: `${this.baseUrl.replace(/\/$/u, '')}/chat/completions`,
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
			},
			contentType: 'application/json',
			throw: false,
			body: JSON.stringify({
				model: this.model,
				messages: [
					{ role: 'system', content: request.system },
					{ role: 'user', content: request.prompt },
				],
				max_tokens: 2048,
				stream: false,
				thinking: { type: 'disabled' },
				response_format: request.responseFormat,
			}),
		});
		if (response.status >= 400) {
			throw new Error(`DeepSeek request failed (${response.status}): ${response.text}`);
		}
		const text = extractChatCompletionText(
			response.json as {
				choices?: Array<{ message?: { content?: string | null } }>;
			},
		);
		if (!text.trim()) {
			throw new Error('DeepSeek response did not include text output.');
		}
		return text.trim();
	}
}

export class OllamaProvider implements Provider {
	constructor(
		private readonly baseUrl: string,
		private readonly model: string,
	) {}

	async analyze(input: AnalysisInput): Promise<AnalysisResult> {
		const prompt = [
			'Return JSON only. Analyze this Obsidian note for review-first organization.',
			'Shape:',
			JSON.stringify({
				title: 'string',
				summary: 'string',
				tags: ['string'],
				suggestedLinks: ['existing note basename'],
				frontmatter: { status: 'organized' },
				appendSections: [{ heading: 'string', content: 'string' }],
				newNotes: [
					{
						title: 'string',
						path: 'AI Notes/example.md',
						content: 'string',
						reason: 'string',
					},
				],
				rationale: ['string'],
			}),
			`Source path: ${input.source.path}`,
			`Source note:\n${truncateText(
				input.source.content,
				input.settings.maxContextChars,
			)}`,
			`Candidate notes:\n${input.candidates
				.slice(0, 8)
				.map((candidate) => `- ${candidate.basename}: ${candidate.excerpt}`)
				.join('\n')}`,
		].join('\n\n');
		const text = await this.generate(prompt, 'json');
		return normalizeAnalysis(JSON.parse(extractFirstJson(text)) as Partial<AnalysisResult>);
	}

	async answer(
		question: string,
		candidates: CandidateNote[],
		history?: ChatTurn[],
	): Promise<string> {
		return this.generate(
			[
				'Answer from the provided Obsidian notes only. Cite note basenames.',
				buildAnswerPrompt(question, candidates, history),
			].join('\n\n'),
		);
	}

	private async generate(prompt: string, format?: 'json'): Promise<string> {
		const response = await requestUrl({
			url: `${this.baseUrl.replace(/\/$/u, '')}/api/generate`,
			method: 'POST',
			contentType: 'application/json',
			throw: false,
			body: JSON.stringify({
				model: this.model,
				prompt,
				stream: false,
				format,
			}),
		});
		if (response.status >= 400) {
			throw new Error(`Ollama request failed (${response.status}): ${response.text}`);
		}
		const payload = response.json as { response?: string };
		if (!payload.response?.trim()) {
			throw new Error('Ollama response did not include generated text.');
		}
		return payload.response.trim();
	}
}

export function extractAnthropicText(payload: {
	content?: Array<{ type?: string; text?: string }>;
}): string {
	return (
		payload.content
			?.filter((content) => content.type === 'text' && content.text)
			.map((content) => content.text)
			.join('\n') ?? ''
	);
}

export function extractGeminiText(payload: {
	candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}): string {
	return (
		payload.candidates
			?.flatMap((candidate) => candidate.content?.parts ?? [])
			.map((part) => part.text)
			.filter((text): text is string => Boolean(text))
			.join('\n') ?? ''
	);
}

export function extractChatCompletionText(payload: {
	choices?: Array<{ message?: { content?: string | null } }>;
}): string {
	return (
		payload.choices
			?.map((choice) => choice.message?.content)
			.filter((text): text is string => Boolean(text))
			.join('\n') ?? ''
	);
}

export function extractOutputText(payload: {
	output_text?: string;
	output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}): string {
	if (payload.output_text) {
		return payload.output_text;
	}
	return (
		payload.output
			?.flatMap((item) => item.content ?? [])
			.filter((content) => content.type === 'output_text' && content.text)
			.map((content) => content.text)
			.join('\n') ?? ''
	);
}

function normalizeAnalysis(value: Partial<AnalysisResult>): AnalysisResult {
	return {
		title: value.title ?? 'Organize note',
		summary: value.summary ?? '',
		tags: uniqueStrings(value.tags ?? []).map((tag) => slugify(tag)),
		suggestedLinks: uniqueStrings(value.suggestedLinks ?? []),
		frontmatter: value.frontmatter ?? {},
		appendSections: value.appendSections ?? [],
		newNotes: value.newNotes ?? [],
		rationale: value.rationale ?? [],
	};
}

function buildJsonAnalysisPrompt(input: AnalysisInput): string {
	return [
		'Return JSON only. Analyze this Obsidian note for review-first organization.',
		'Shape:',
		JSON.stringify({
			title: 'string',
			summary: 'string',
			tags: ['string'],
			suggestedLinks: ['existing note basename'],
			frontmatter: { status: 'organized' },
			appendSections: [{ heading: 'string', content: 'string' }],
			newNotes: [
				{
					title: 'string',
					path: 'AI Notes/example.md',
					content: 'string',
					reason: 'string',
				},
			],
			rationale: ['string'],
		}),
		`Source path: ${input.source.path}`,
		`Source note:\n${truncateText(
			input.source.content,
			input.settings.maxContextChars,
		)}`,
		`Candidate notes:\n${input.candidates
			.slice(0, 12)
			.map(
				(candidate) =>
					`- ${candidate.basename} (${candidate.path}): ${candidate.excerpt}`,
			)
			.join('\n')}`,
		'Use suggestedLinks values that match existing note basenames when possible.',
	].join('\n\n');
}

function formatHistory(history?: ChatTurn[]): string {
	if (!history || history.length === 0) {
		return '';
	}
	const lines = history.map(
		(turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`,
	);
	return `Earlier in this conversation (for context):\n${lines.join('\n')}`;
}

function buildAnswerPrompt(
	question: string,
	candidates: CandidateNote[],
	history?: ChatTurn[],
): string {
	const sections: string[] = [];
	const conversation = formatHistory(history);
	if (conversation) {
		sections.push(conversation);
	}
	sections.push(`Question: ${question}`);
	sections.push(
		`Relevant notes:\n${candidates
			.map(
				(candidate) =>
					`## ${candidate.basename}\nPath: ${candidate.path}\n${candidate.excerpt}`,
			)
			.join('\n\n')}`,
	);
	return sections.join('\n\n');
}

function normalizeGeminiModelPath(model: string): string {
	const normalized = model.startsWith('models/') ? model : `models/${model}`;
	return normalized.split('/').map(encodeURIComponent).join('/');
}

function extractFirstJson(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
		return trimmed;
	}
	const start = trimmed.indexOf('{');
	const end = trimmed.lastIndexOf('}');
	if (start >= 0 && end > start) {
		return trimmed.slice(start, end + 1);
	}
	throw new Error('Model response did not contain a JSON object.');
}

function titleCase(value: string): string {
	return value
		.split(/[-_\s]+/u)
		.filter(Boolean)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(' ');
}
