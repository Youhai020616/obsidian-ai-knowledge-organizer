import type { App } from 'obsidian';
import type {
	AuditEntry,
	ChangeProposal,
	CitationReference,
	Conversation,
	OrganizerSettings,
	OrganizerState,
} from './types';

/**
 * Narrow capability surface the plugin exposes to its service layer. The plugin
 * implements this interface and passes `this`, so services read live
 * `settings`/`state` and mutate them in place — never a snapshot.
 */
export interface OrganizerContext {
	app: App;
	settings: OrganizerSettings;
	state: OrganizerState;
	savePluginData(): Promise<void>;
	activateView(): Promise<void>;
	getEffectiveSettings(conversationId?: string): OrganizerSettings;
	findProposal(proposalId: string): ChangeProposal | undefined;
	addAudit(entry: Omit<AuditEntry, 'id' | 'at'>): void;
	captureError(
		error: unknown,
		message: string,
		proposalId?: string,
	): Promise<void>;
	appendUserMessage(text: string): Conversation;
	appendAssistantMessageToConversation(
		conversationId: string,
		message: {
			text?: string;
			citations?: CitationReference[];
			proposalIds?: string[];
		},
	): void;
	appendAssistantMessage(message: {
		text?: string;
		citations?: CitationReference[];
		proposalIds?: string[];
	}): void;
	ensureActiveConversation(): Conversation;
	getActiveConversation(): Conversation | undefined;
}
