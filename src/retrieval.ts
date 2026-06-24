import { CandidateNote, NoteSnapshot, SearchIndex } from './types';
import { buildExcerpt, nowIso, tokenize } from './utils';

export function rankCandidates(
	query: string,
	notes: NoteSnapshot[],
	options: { excludePath?: string; limit: number },
): CandidateNote[] {
	const queryTerms = [...new Set(tokenize(query))];
	if (queryTerms.length === 0) {
		return [];
	}
	const corpus = notes.filter((note) => note.path !== options.excludePath);
	const documentFrequency = buildDocumentFrequency(corpus, queryTerms);
	const avgLength =
		corpus.reduce((sum, note) => sum + tokenize(note.content).length, 0) /
		Math.max(1, corpus.length);

	return corpus
		.map((note) => scoreCandidate(note, queryTerms, documentFrequency, corpus.length, avgLength))
		.filter((candidate) => candidate.score > 0)
		.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
		.slice(0, options.limit);
}

export function buildSearchIndex(notes: NoteSnapshot[]): SearchIndex {
	return {
		builtAt: nowIso(),
		noteCount: notes.length,
		entries: notes.map((note) => {
			const terms: Record<string, number> = {};
			const bodyTokens = tokenize(note.content);
			for (const token of bodyTokens) {
				terms[token] = (terms[token] ?? 0) + 1;
			}
			return {
				path: note.path,
				basename: note.basename,
				excerpt: buildExcerpt(note.content),
				length: bodyTokens.length,
				terms,
				titleTerms: tokenize(note.basename),
			};
		}),
	};
}

export function rankIndexedCandidates(
	query: string,
	index: SearchIndex,
	options: { excludePath?: string; limit: number },
): CandidateNote[] {
	const queryTerms = [...new Set(tokenize(query))];
	if (queryTerms.length === 0) {
		return [];
	}
	const entries = index.entries.filter((entry) => entry.path !== options.excludePath);
	const documentFrequency = new Map<string, number>();
	for (const term of queryTerms) {
		documentFrequency.set(
			term,
			entries.filter((entry) => entry.terms[term] || entry.titleTerms.includes(term))
				.length,
		);
	}
	const avgLength =
		entries.reduce((sum, entry) => sum + entry.length, 0) / Math.max(1, entries.length);
	const k1 = 1.2;
	const b = 0.75;
	return entries
		.map((entry) => {
			let score = 0;
			for (const term of queryTerms) {
				const tf = entry.terms[term] ?? 0;
				const titleBoost = entry.titleTerms.includes(term) ? 2.5 : 0;
				const df = documentFrequency.get(term) ?? 0;
				const idf = Math.log(1 + (entries.length - df + 0.5) / (df + 0.5));
				const normalizedTf =
					tf === 0
						? 0
						: (tf * (k1 + 1)) /
							(tf + k1 * (1 - b + b * (entry.length / Math.max(1, avgLength))));
				score += idf * normalizedTf + titleBoost;
			}
			return {
				path: entry.path,
				basename: entry.basename,
				score: Number(score.toFixed(4)),
				excerpt: entry.excerpt,
			};
		})
		.filter((candidate) => candidate.score > 0)
		.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
		.slice(0, options.limit);
}

function scoreCandidate(
	note: NoteSnapshot,
	queryTerms: string[],
	documentFrequency: Map<string, number>,
	totalDocuments: number,
	avgLength: number,
): CandidateNote {
	const bodyTokens = tokenize(note.content);
	const titleTokens = tokenize(note.basename);
	const termCounts = new Map<string, number>();
	for (const token of bodyTokens) {
		termCounts.set(token, (termCounts.get(token) ?? 0) + 1);
	}

	let score = 0;
	let firstHit: string | undefined;
	const k1 = 1.2;
	const b = 0.75;
	for (const term of queryTerms) {
		const tf = termCounts.get(term) ?? 0;
		const titleBoost = titleTokens.includes(term) ? 2.5 : 0;
		if (tf > 0 || titleBoost > 0) {
			firstHit ??= term;
		}
		const df = documentFrequency.get(term) ?? 0;
		const idf = Math.log(1 + (totalDocuments - df + 0.5) / (df + 0.5));
		const normalizedTf =
			tf === 0
				? 0
				: (tf * (k1 + 1)) /
					(tf + k1 * (1 - b + b * (bodyTokens.length / Math.max(1, avgLength))));
		score += idf * normalizedTf + titleBoost;
	}

	return {
		path: note.path,
		basename: note.basename,
		score: Number(score.toFixed(4)),
		excerpt: buildExcerpt(note.content, firstHit),
	};
}

function buildDocumentFrequency(
	notes: NoteSnapshot[],
	queryTerms: string[],
): Map<string, number> {
	const frequency = new Map<string, number>();
	for (const note of notes) {
		const tokens = new Set(tokenize(`${note.basename}\n${note.content}`));
		for (const term of queryTerms) {
			if (tokens.has(term)) {
				frequency.set(term, (frequency.get(term) ?? 0) + 1);
			}
		}
	}
	return frequency;
}
