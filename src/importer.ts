import { requestUrl } from 'obsidian';
import { slugify, nowIso } from './utils';

export interface ImportedWebPage {
	title: string;
	url: string;
	content: string;
	fileName: string;
}

export async function importUrlAsMarkdown(url: string): Promise<ImportedWebPage> {
	const normalizedUrl = normalizeUrl(url);
	const response = await requestUrl({
		url: normalizedUrl,
		method: 'GET',
		throw: false,
	});
	if (response.status >= 400) {
		throw new Error(`URL import failed (${response.status}): ${response.text.slice(0, 200)}`);
	}
	const title = extractTitle(response.text) ?? normalizedUrl;
	const body = htmlToMarkdown(response.text);
	const fileName = `${slugify(title)}.md`;
	return {
		title,
		url: normalizedUrl,
		fileName,
		content: [
			'---',
			`source_url: ${JSON.stringify(normalizedUrl)}`,
			`imported: ${nowIso()}`,
			'tags:',
			'  - web-import',
			'---',
			'',
			`# ${title}`,
			'',
			body || `Imported from ${normalizedUrl}.`,
			'',
		].join('\n'),
	};
}

function normalizeUrl(url: string): string {
	const trimmed = url.trim();
	if (!/^https?:\/\//u.test(trimmed)) {
		throw new Error('Only http:// and https:// URLs can be imported.');
	}
	return trimmed;
}

export function extractTitle(html: string): string | null {
	const title = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1];
	if (!title) {
		return null;
	}
	return decodeEntities(stripTags(title)).replace(/\s+/gu, ' ').trim();
}

export function htmlToMarkdown(html: string): string {
	const readable = selectReadableHtml(stripNoisyHtml(html));
	return decodeEntities(
		readable
			.replace(/<img[^>]*alt=["']([^"']+)["'][^>]*src=["']([^"']+)["'][^>]*>/giu, '\n![$1]($2)\n')
			.replace(/<img[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']+)["'][^>]*>/giu, '\n![$2]($1)\n')
			.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu, '$2 ($1)')
			.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/giu, '\n# $1\n')
			.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/giu, '\n## $1\n')
			.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/giu, '\n### $1\n')
			.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/giu, '\n#### $1\n')
			.replace(/<li[^>]*>([\s\S]*?)<\/li>/giu, '\n- $1')
			.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/giu, '\n> $1\n')
			.replace(/<p[^>]*>([\s\S]*?)<\/p>/giu, '\n$1\n')
			.replace(/<br\s*\/?>/giu, '\n')
			.replace(/<\/(div|section|article|main|header|footer|ul|ol)>/giu, '\n')
			.replace(/<[^>]+>/gu, ' '),
	)
		.replace(/[ \t]+\n/gu, '\n')
		.replace(/\n[ \t]+/gu, '\n')
		.replace(/\n{3,}/gu, '\n\n')
		.replace(/[ \t]{2,}/gu, ' ')
		.trim()
		.slice(0, 50000);
}

function stripNoisyHtml(html: string): string {
	return html
			.replace(/<script[\s\S]*?<\/script>/giu, '')
			.replace(/<style[\s\S]*?<\/style>/giu, '')
			.replace(/<noscript[\s\S]*?<\/noscript>/giu, '')
			.replace(/<svg[\s\S]*?<\/svg>/giu, '')
			.replace(/<iframe[\s\S]*?<\/iframe>/giu, '')
			.replace(/<(nav|footer|aside|form|button)\b[\s\S]*?<\/\1>/giu, '')
			.replace(/<header\b[\s\S]*?<\/header>/giu, '');
}

function selectReadableHtml(html: string): string {
	const body = /<body[^>]*>([\s\S]*?)<\/body>/iu.exec(html)?.[1] ?? html;
	const blocks = [
		...extractTagBlocks(body, 'article'),
		...extractTagBlocks(body, 'main'),
		...extractContentBlocks(body),
	];
	const best = blocks
		.map((block) => ({ block, score: scoreHtmlBlock(block) }))
		.filter((candidate) => candidate.score > 200)
		.sort((left, right) => right.score - left.score)[0];
	return best?.block ?? body;
}

function extractTagBlocks(html: string, tagName: string): string[] {
	const pattern = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'giu');
	return Array.from(html.matchAll(pattern), (match) => match[0] ?? '');
}

function extractContentBlocks(html: string): string[] {
	return Array.from(
		html.matchAll(
			/<(section|div)\b[^>]*(?:id|class)=["'][^"']*(?:article|content|entry|main|post|story)[^"']*["'][^>]*>[\s\S]*?<\/\1>/giu,
		),
		(match) => match[0] ?? '',
	);
}

function scoreHtmlBlock(html: string): number {
	const textLength = stripTags(html).replace(/\s+/gu, ' ').trim().length;
	const paragraphCount = (html.match(/<p\b/giu) ?? []).length;
	const headingCount = (html.match(/<h[1-4]\b/giu) ?? []).length;
	const linkTextLength = Array.from(
		html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/giu),
		(match) => stripTags(match[1] ?? '').length,
	).reduce((total, length) => total + length, 0);
	return textLength + paragraphCount * 80 + headingCount * 120 - linkTextLength * 0.4;
}

function stripTags(value: string): string {
	return value.replace(/<[^>]+>/gu, ' ');
}

function decodeEntities(value: string): string {
	return value
		.replace(/&nbsp;/giu, ' ')
		.replace(/&amp;/giu, '&')
		.replace(/&lt;/giu, '<')
		.replace(/&gt;/giu, '>')
		.replace(/&quot;/giu, '"')
		.replace(/&#39;/giu, "'")
		.replace(/&#x([0-9a-f]+);/giu, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#([0-9]+);/gu, (_, decimal: string) =>
			String.fromCodePoint(Number.parseInt(decimal, 10)),
		);
}
