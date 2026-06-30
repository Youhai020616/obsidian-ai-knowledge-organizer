import type { TFile } from 'obsidian';
import type { OrganizerContext } from '../context';
import { createProvider } from '../providers';
import { rankIndexedCandidates } from '../retrieval';
import { createId, nowIso, redactSecrets } from '../utils';
import { findCandidates, snapshotFile } from '../vault';
import type {
	AskAnswer,
	CandidateNote,
	CitationReference,
	OrganizerSettings,
} from '../types';

export class AskService {
	constructor(private readonly ctx: OrganizerContext) {}

	async askVault(question: string): Promise<void> {
		const trimmed = question.trim();
		if (!trimmed) {
			return;
		}
		try {
			const conversation = this.ctx.appendUserMessage(trimmed);
			const providerSettings = this.ctx.getEffectiveSettings(
				conversation.id,
			);
			const activeScopeFile =
				providerSettings.askScope === 'active'
					? this.ctx.app.workspace.getActiveFile()
					: null;
			const rawCitations = this.ctx.state.searchIndex
				? rankIndexedCandidates(trimmed, this.ctx.state.searchIndex, {
						limit: providerSettings.askSearchLimit,
					})
				: await findCandidates(
						this.ctx.app,
						trimmed,
						undefined,
						providerSettings.askSearchLimit,
					);
			// Redact secrets before content reaches a provider or the UI.
			const citations = rawCitations.map((candidate) => ({
				...candidate,
				excerpt: redactSecrets(candidate.excerpt),
			}));
			// Active-note scope: surface the note you're looking at first so
			// "this note" resolves to it instead of a blind vault search.
			const contextCitations = await this.withActiveNoteContext(
				citations,
				providerSettings,
				activeScopeFile,
			);
			// Recent turns (excluding the question just appended) give the
			// provider conversational memory. Redact again at the egress boundary.
			const history = conversation.messages
				.filter(
					(message) =>
						(message.role === 'user' ||
							message.role === 'assistant') &&
						!!message.text,
				)
				.slice(-7, -1)
				.map((message) => ({
					role: message.role as 'user' | 'assistant',
					text: redactSecrets((message.text ?? '').slice(0, 1000)),
				}));
			const safeQuestion = redactSecrets(trimmed);
			const answer = await createProvider(providerSettings).answer(
				safeQuestion,
				contextCitations,
				history,
			);
			const askAnswer: AskAnswer = {
				id: createId('ask'),
				question: safeQuestion,
				answer: redactSecrets(answer),
				citations: contextCitations,
				createdAt: nowIso(),
			};
			this.ctx.state.lastAsk = askAnswer;
			this.ctx.appendAssistantMessageToConversation(conversation.id, {
				text: answer,
				citations: toCitationReferences(contextCitations),
			});
			this.ctx.addAudit({
				action: 'ask',
				message: `Answered vault question using ${contextCitations.length} citation(s).`,
				paths: contextCitations.map((candidate) => candidate.path),
			});
			await this.ctx.savePluginData();
		} catch (error) {
			await this.ctx.captureError(error, 'Ask Vault failed');
		}
	}

	private async withActiveNoteContext(
		citations: CandidateNote[],
		settings: OrganizerSettings,
		activeFile: TFile | null,
	): Promise<CandidateNote[]> {
		if (settings.askScope !== 'active') {
			return citations;
		}
		if (!activeFile || activeFile.extension !== 'md') {
			return citations;
		}
		const snapshot = await snapshotFile(this.ctx.app, activeFile);
		const maxContextChars = Math.max(1000, settings.maxContextChars);
		const activeCandidate: CandidateNote = {
			path: snapshot.path,
			basename: snapshot.basename,
			score: Number.MAX_SAFE_INTEGER,
			excerpt: redactSecrets(snapshot.content.slice(0, maxContextChars)),
		};
		const rest = citations.filter(
			(candidate) => candidate.path !== snapshot.path,
		);
		return [activeCandidate, ...rest].slice(
			0,
			Math.max(settings.askSearchLimit, 1),
		);
	}
}

function toCitationReferences(citations: CandidateNote[]): CitationReference[] {
	return citations.map((citation) => ({
		path: citation.path,
		basename: citation.basename,
	}));
}
