import { MarkdownView, Notice, Plugin } from 'obsidian';
import type { OrganizerContext } from './context';
import { DEFAULT_SETTINGS, DEFAULT_STATE } from './defaults';
import { stringifyError } from './errors';
import { FileImportModal, UrlImportModal } from './modals';
import { OrganizerSettingTab } from './settings';
import {
	AuditEntry,
	ChangeProposal,
	ChatMessage,
	CitationReference,
	Conversation,
	OrganizerData,
	OrganizerSettings,
	OrganizerState,
	ProviderId,
} from './types';
import { createId, nowIso, redactSecrets } from './utils';
import { ensureFolder } from './vault';
import { AnalysisService } from './services/analysis';
import { AskService } from './services/ask';
import { InboxImportService } from './services/inbox-import';
import { MaintenanceService } from './services/maintenance';
import { ProposalService } from './services/proposals';
import { OrganizerView, VIEW_TYPE_AIKO } from './view';

export default class AiKnowledgeOrganizerPlugin
	extends Plugin
	implements OrganizerContext
{
	settings: OrganizerSettings = DEFAULT_SETTINGS;
	state: OrganizerState = DEFAULT_STATE;
	private view?: OrganizerView;
	private statusBar?: HTMLElement;
	private readonly analysis = new AnalysisService(this);
	private readonly ask = new AskService(this);
	private readonly inboxImport = new InboxImportService(this);
	private readonly maintenance = new MaintenanceService(this);
	private readonly proposals = new ProposalService(this);

	async onload(): Promise<void> {
		await this.loadPluginData();

		this.registerView(
			VIEW_TYPE_AIKO,
			(leaf) => new OrganizerView(leaf, this),
		);

		this.addRibbonIcon('workflow', 'AI knowledge organizer', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-review-queue',
			name: 'Open review queue',
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: 'analyze-active-note',
			name: 'Analyze active note',
			checkCallback: (checking) => {
				const view =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) {
					return false;
				}
				if (!checking) {
					void this.analyzeActiveNote();
				}
				return true;
			},
		});

		this.addCommand({
			id: 'scan-inbox',
			name: 'Scan inbox folder',
			callback: () => {
				void this.scanInbox();
			},
		});

		this.addCommand({
			id: 'import-url-to-inbox',
			name: 'Import URL to inbox',
			callback: () => {
				new UrlImportModal(this, (url) => {
					void this.importUrlToInbox(url);
				}).open();
			},
		});

		this.addCommand({
			id: 'import-files-to-inbox',
			name: 'Import files to inbox',
			callback: () => {
				new FileImportModal(this, (files) => {
					void this.importFilesToInbox(files);
				}).open();
			},
		});

		this.addCommand({
			id: 'ask-vault',
			name: 'Ask vault',
			callback: () => {
				void this.activateView();
				this.view?.focusAskInput();
			},
		});

		this.addCommand({
			id: 'rebuild-search-index',
			name: 'Rebuild search index',
			callback: () => {
				void this.rebuildSearchIndex();
			},
		});

		this.addCommand({
			id: 'run-vault-audit',
			name: 'Run vault audit',
			callback: () => {
				void this.runVaultAudit();
			},
		});

		this.addCommand({
			id: 'create-governance-proposals',
			name: 'Create governance proposals',
			callback: () => {
				void this.createGovernanceProposals();
			},
		});

		this.addSettingTab(new OrganizerSettingTab(this.app, this));
		this.statusBar = this.addStatusBarItem();
		this.updateStatusBar();

		this.app.workspace.onLayoutReady(() => {
			void this.initializeInboxFolder();
		});
	}

	onunload(): void {}

	async loadPluginData(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<OrganizerData> | null;
		const rawConversations = loaded?.state?.conversations ?? [];
		const sanitizedConversations = sanitizeConversations(rawConversations);
		this.settings = {
			...DEFAULT_SETTINGS,
			...(loaded?.settings ?? {}),
		};
		this.state = {
			...DEFAULT_STATE,
			...(loaded?.state ?? {}),
			proposals: loaded?.state?.proposals ?? [],
			auditLog: loaded?.state?.auditLog ?? [],
			conversations: sanitizedConversations,
		};
		this.migrateOrphanProposals();
		if (
			JSON.stringify(rawConversations) !==
			JSON.stringify(sanitizedConversations)
		) {
			await this.savePluginData();
		}
	}

	/**
	 * One-time migration: surface proposals created before the conversation
	 * model existed so they are not stranded after upgrade.
	 */
	private migrateOrphanProposals(): void {
		if (this.state.conversations.length > 0) {
			return;
		}
		const active = this.state.proposals.filter(
			(proposal) =>
				proposal.status === 'pending' || proposal.status === 'failed',
		);
		if (active.length === 0) {
			return;
		}
		const at = nowIso();
		const conversation: Conversation = {
			id: createId('conv'),
			title: 'Pending proposals',
			createdAt: at,
			updatedAt: at,
			messages: [
				{
					id: createId('msg'),
					role: 'assistant',
					at,
					text: `You have ${active.length} proposal(s) waiting for review from a previous session.`,
					proposalIds: active.map((proposal) => proposal.id),
				},
			],
		};
		this.state.conversations.unshift(conversation);
		this.state.activeConversationId = conversation.id;
	}

	async savePluginData(): Promise<void> {
		await this.saveData({
			settings: this.settings,
			state: this.state,
		} satisfies OrganizerData);
		this.updateStatusBar();
		this.refreshView();
	}

	private async initializeInboxFolder(): Promise<void> {
		if (!this.settings.autoCreateInbox) {
			return;
		}
		try {
			await ensureFolder(this.app, this.settings.inboxFolder);
		} catch (error) {
			await this.captureError(
				error,
				'Inbox folder initialization failed',
			);
		}
	}

	async activateView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AIKO);
		let leaf = leaves[0];
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false) ?? undefined;
			if (!leaf) {
				new Notice('Could not open AI knowledge organizer view.');
				return;
			}
			await leaf.setViewState({ type: VIEW_TYPE_AIKO, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
	}

	setView(view: OrganizerView): void {
		this.view = view;
	}

	clearView(view: OrganizerView): void {
		if (this.view === view) {
			this.view = undefined;
		}
	}

	// ---- Conversation layer ----
	// Messages reference proposals by id; the proposal engine stays untouched.

	getActiveConversation(): Conversation | undefined {
		return this.getConversation(this.state.activeConversationId);
	}

	getConversation(conversationId?: string): Conversation | undefined {
		if (!conversationId) return undefined;
		return this.state.conversations.find(
			(conversation) => conversation.id === conversationId,
		);
	}

	getEffectiveSettings(
		conversationId = this.state.activeConversationId,
	): OrganizerSettings {
		const providerOverride =
			this.getConversation(conversationId)?.providerOverride;
		return {
			...this.settings,
			...(providerOverride ? { provider: providerOverride } : {}),
		};
	}

	private createConversation(): Conversation {
		const conversation: Conversation = {
			id: createId('conv'),
			title: 'New conversation',
			createdAt: nowIso(),
			updatedAt: nowIso(),
			messages: [],
		};
		this.state.conversations.unshift(conversation);
		this.state.activeConversationId = conversation.id;
		return conversation;
	}

	ensureActiveConversation(): Conversation {
		return this.getActiveConversation() ?? this.createConversation();
	}

	async startNewConversation(): Promise<void> {
		this.createConversation();
		await this.savePluginData();
		this.view?.render();
	}

	async activateConversation(conversationId: string): Promise<void> {
		if (!this.getConversation(conversationId)) {
			new Notice('Conversation was not found.');
			return;
		}
		this.state.activeConversationId = conversationId;
		await this.savePluginData();
		await this.activateView();
		this.view?.render();
	}

	async openFirstPendingProposal(): Promise<void> {
		const proposal = this.state.proposals.find(
			(candidate) => candidate.status === 'pending',
		);
		if (!proposal) {
			new Notice('No pending proposals.');
			return;
		}
		await this.openProposal(proposal.id);
	}

	async openProposal(proposalId: string): Promise<void> {
		const proposal = this.findProposal(proposalId);
		if (!proposal) {
			new Notice('Proposal was not found.');
			return;
		}
		const conversation = this.ensureConversationForProposal(proposal);
		this.state.activeConversationId = conversation.id;
		await this.savePluginData();
		await this.activateView();
		this.view?.render();
		window.setTimeout(() => this.view?.scrollToProposal(proposalId), 0);
	}

	private findConversationForProposal(
		proposalId: string,
	): Conversation | undefined {
		return this.state.conversations.find((conversation) =>
			conversation.messages.some((message) =>
				(message.proposalIds ?? []).includes(proposalId),
			),
		);
	}

	private ensureConversationForProposal(
		proposal: ChangeProposal,
	): Conversation {
		const existing = this.findConversationForProposal(proposal.id);
		if (existing) return existing;
		const conversation = this.createConversation();
		conversation.title = proposal.title.slice(0, 48) || 'Pending proposal';
		this.appendMessageToConversation(conversation.id, {
			role: 'assistant',
			text: `Review proposal: ${proposal.title}`,
			proposalIds: [proposal.id],
		});
		return conversation;
	}

	private appendMessageToConversation(
		conversationId: string,
		message: Omit<ChatMessage, 'id' | 'at'>,
	): ChatMessage | undefined {
		const conversation = this.getConversation(conversationId);
		if (!conversation) return undefined;
		const full: ChatMessage = {
			id: createId('msg'),
			at: nowIso(),
			...message,
		};
		conversation.messages.push(full);
		conversation.updatedAt = full.at;
		if (
			message.role === 'user' &&
			message.text &&
			conversation.title === 'New conversation'
		) {
			conversation.title = message.text.slice(0, 48);
		}
		return full;
	}

	private appendMessage(
		message: Omit<ChatMessage, 'id' | 'at'>,
	): ChatMessage {
		return this.appendMessageToConversation(
			this.ensureActiveConversation().id,
			message,
		) as ChatMessage;
	}

	appendUserMessage(text: string): Conversation {
		const conversation = this.ensureActiveConversation();
		this.appendMessageToConversation(conversation.id, {
			role: 'user',
			text: redactSecrets(text),
		});
		return conversation;
	}

	appendAssistantMessageToConversation(
		conversationId: string,
		message: {
			text?: string;
			citations?: CitationReference[];
			proposalIds?: string[];
		},
	): void {
		this.appendMessageToConversation(conversationId, {
			role: 'assistant',
			...message,
			text: message.text ? redactSecrets(message.text) : undefined,
		});
	}

	appendAssistantMessage(message: {
		text?: string;
		citations?: CitationReference[];
		proposalIds?: string[];
	}): void {
		this.appendAssistantMessageToConversation(
			this.ensureActiveConversation().id,
			message,
		);
	}

	analyzeActiveNote(): Promise<void> {
		return this.analysis.analyzeActiveNote();
	}

	scanInbox(): Promise<void> {
		return this.analysis.scanInbox();
	}

	importUrlToInbox(url: string): Promise<void> {
		return this.inboxImport.importUrlToInbox(url);
	}

	importFilesToInbox(files: FileList): Promise<void> {
		return this.inboxImport.importFilesToInbox(files);
	}

	applyProposal(proposalId: string): Promise<void> {
		return this.proposals.applyProposal(proposalId);
	}

	rejectProposal(proposalId: string): Promise<void> {
		return this.proposals.rejectProposal(proposalId);
	}

	rollbackAppliedProposal(proposalId: string): Promise<void> {
		return this.proposals.rollbackAppliedProposal(proposalId);
	}

	askVault(question: string): Promise<void> {
		return this.ask.askVault(question);
	}

	rebuildSearchIndex(): Promise<void> {
		return this.maintenance.rebuildSearchIndex();
	}

	runVaultAudit(): Promise<void> {
		return this.maintenance.runVaultAudit();
	}

	createGovernanceProposals(): Promise<void> {
		return this.maintenance.createGovernanceProposals();
	}

	toggleOperation(
		proposalId: string,
		operationId: string,
		selected: boolean,
	): Promise<void> {
		return this.proposals.toggleOperation(
			proposalId,
			operationId,
			selected,
		);
	}

	findProposal(proposalId: string): ChangeProposal | undefined {
		return this.state.proposals.find(
			(proposal) => proposal.id === proposalId,
		);
	}

	private refreshView(): void {
		this.view?.render();
	}

	private updateStatusBar(): void {
		if (!this.statusBar) {
			return;
		}
		const pending = this.state.proposals.filter(
			(proposal) => proposal.status === 'pending',
		).length;
		this.statusBar.setText(`AIKO: ${pending} pending`);
	}

	addAudit(entry: Omit<AuditEntry, 'id' | 'at'>): void {
		this.state.auditLog.unshift({
			id: createId('audit'),
			at: nowIso(),
			...entry,
		});
		this.state.auditLog = this.state.auditLog.slice(0, 200);
	}

	async captureError(
		error: unknown,
		message: string,
		proposalId?: string,
	): Promise<void> {
		const details = stringifyError(error);
		this.addAudit({
			action: 'error',
			message: `${message}: ${details}`,
			proposalId,
		});
		await this.savePluginData();
		new Notice(`${message}. See review queue log.`);
	}

}

function sanitizeConversations(conversations: Conversation[]): Conversation[] {
	return conversations.map((conversation) => ({
		...conversation,
		title: redactSecrets(conversation.title),
		providerOverride: isProviderId(conversation.providerOverride)
			? conversation.providerOverride
			: undefined,
		messages: (conversation.messages ?? []).map(sanitizeChatMessage),
	}));
}

function sanitizeChatMessage(message: ChatMessage): ChatMessage {
	return {
		...message,
		text: message.text ? redactSecrets(message.text) : undefined,
		citations: sanitizeCitationReferences(message.citations),
	};
}

function sanitizeCitationReferences(
	citations: unknown,
): CitationReference[] | undefined {
	if (!Array.isArray(citations)) {
		return undefined;
	}
	const references = citations.flatMap((citation): CitationReference[] => {
		if (!citation || typeof citation !== 'object') {
			return [];
		}
		const candidate = citation as { basename?: unknown; path?: unknown };
		if (typeof candidate.path !== 'string' || !candidate.path) {
			return [];
		}
		return [
			{
				path: candidate.path,
				basename:
					typeof candidate.basename === 'string' && candidate.basename
						? candidate.basename
						: candidate.path,
			},
		];
	});
	return references.length > 0 ? references : undefined;
}

function isProviderId(value: unknown): value is ProviderId {
	return (
		value === 'heuristic' ||
		value === 'openai' ||
		value === 'anthropic' ||
		value === 'gemini' ||
		value === 'deepseek' ||
		value === 'ollama'
	);
}
