import {
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';
import { DEFAULT_SETTINGS, DEFAULT_STATE } from './defaults';
import { buildLineDiff, compactDiff, summarizeDiff } from './diff';
import { buildGovernanceProposals } from './governance';
import { buildHealthReport } from './health';
import { importUrlAsMarkdown } from './importer';
import { extractPdfText } from './pdf';
import { createProvider } from './providers';
import { buildSearchIndex, rankIndexedCandidates } from './retrieval';
import { OrganizerSettingTab } from './settings';
import {
	AskAnswer,
	AuditEntry,
	CandidateNote,
	CitationReference,
	ChangeProposal,
	ChatMessage,
	Conversation,
	OrganizerData,
	OrganizerSettings,
	OrganizerState,
	PatchOperation,
	ProviderId,
} from './types';
import {
	buildProposal,
	createId,
	nowIso,
	redactSecrets,
	selectedOperations,
	setOperationSelected,
} from './utils';
import {
	applyProposalToVault,
	ensureFolder,
	findCandidates,
	getActiveMarkdownFile,
	getAllMarkdownSnapshots,
	getExistingPaths,
	getInboxFiles,
	rollbackProposal,
	snapshotFile,
} from './vault';

const VIEW_TYPE_AIKO = 'aiko-review-view';

export default class AiKnowledgeOrganizerPlugin extends Plugin {
	settings: OrganizerSettings = DEFAULT_SETTINGS;
	state: OrganizerState = DEFAULT_STATE;
	private view?: OrganizerView;
	private statusBar?: HTMLElement;

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

	private appendUserMessage(text: string): Conversation {
		const conversation = this.ensureActiveConversation();
		this.appendMessageToConversation(conversation.id, {
			role: 'user',
			text: redactSecrets(text),
		});
		return conversation;
	}

	private appendAssistantMessageToConversation(
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

	private appendAssistantMessage(message: {
		text?: string;
		citations?: CitationReference[];
		proposalIds?: string[];
	}): void {
		this.appendAssistantMessageToConversation(
			this.ensureActiveConversation().id,
			message,
		);
	}

	async analyzeActiveNote(): Promise<void> {
		const file = await getActiveMarkdownFile(this.app);
		if (!file) {
			new Notice('Open a Markdown note before analyzing.');
			return;
		}
		const conversation = this.appendUserMessage(
			`Analyze active note: ${file.basename}`,
		);
		const providerSettings = this.getEffectiveSettings(conversation.id);
		const proposal = await this.analyzeFile(file, providerSettings);
		this.appendAssistantMessageToConversation(
			conversation.id,
			proposal
				? {
						text: `Created an organization proposal for ${file.basename}. Review it below.`,
						proposalIds: [proposal.id],
					}
				: { text: `Could not create a proposal for ${file.basename}.` },
		);
		await this.savePluginData();
		await this.activateView();
	}

	async analyzeFile(
		file: TFile,
		providerSettings: OrganizerSettings,
	): Promise<ChangeProposal | null> {
		try {
			new Notice(`Analyzing ${file.basename}...`);
			const source = await snapshotFile(this.app, file);
			const candidates = await findCandidates(
				this.app,
				`${source.basename}\n${source.content}`,
				source.path,
				providerSettings.askSearchLimit,
			);
			const provider = createProvider(providerSettings);
			// Redact secrets in the copy sent to the provider; the proposal is
			// still built from the original source so diffs stay accurate.
			const analysis = await provider.analyze({
				source: { ...source, content: redactSecrets(source.content) },
				candidates: candidates.map((candidate) => ({
					...candidate,
					excerpt: redactSecrets(candidate.excerpt),
				})),
				settings: providerSettings,
			});
			const proposal = buildProposal(
				source,
				analysis,
				await getExistingPaths(this.app),
			);
			this.state.proposals.unshift(proposal);
			this.addAudit({
				action: 'analyze',
				message: `Created proposal for ${source.path}.`,
				proposalId: proposal.id,
				paths: selectedOperations(proposal).map(
					(operation) => operation.path,
				),
			});
			await this.savePluginData();
			await this.activateView();
			new Notice('Review proposal created.');
			return proposal;
		} catch (error) {
			await this.captureError(error, `Analyze failed for ${file.path}`);
			return null;
		}
	}

	async scanInbox(): Promise<void> {
		try {
			const conversation = this.appendUserMessage('Organize my inbox');
			const providerSettings = this.getEffectiveSettings(conversation.id);
			await ensureFolder(this.app, this.settings.inboxFolder);
			const files = await getInboxFiles(
				this.app,
				this.settings.inboxFolder,
			);
			if (files.length === 0) {
				this.appendAssistantMessageToConversation(conversation.id, {
					text: `No Markdown files found in ${this.settings.inboxFolder}.`,
				});
				await this.savePluginData();
				return;
			}
			const createdIds: string[] = [];
			for (const file of files) {
				const proposal = await this.analyzeFile(file, providerSettings);
				if (proposal) {
					createdIds.push(proposal.id);
				}
			}
			this.appendAssistantMessageToConversation(conversation.id, {
				text: `Scanned ${files.length} note(s) and created ${createdIds.length} proposal(s). Review each one below.`,
				proposalIds: createdIds,
			});
			this.addAudit({
				action: 'scan-inbox',
				message: `Scanned ${files.length} inbox file(s); created ${createdIds.length} proposal(s).`,
				paths: files.map((file) => file.path),
			});
			await this.savePluginData();
		} catch (error) {
			await this.captureError(error, 'Inbox scan failed');
		}
	}

	async importUrlToInbox(url: string): Promise<void> {
		try {
			const conversation = this.appendUserMessage(`Import URL: ${url}`);
			new Notice('Importing URL...');
			const page = await importUrlAsMarkdown(url);
			await ensureFolder(this.app, this.settings.inboxFolder);
			const existingPaths = await getExistingPaths(this.app);
			const path = uniquePath(
				`${this.settings.inboxFolder}/${page.fileName}`,
				existingPaths,
			);
			await this.app.vault.create(path, page.content);
			this.appendAssistantMessageToConversation(conversation.id, {
				text: `Imported into ${path}. Run "Organize my inbox" to generate proposals.`,
			});
			this.addAudit({
				action: 'import',
				message: `Imported ${page.url} into ${path}.`,
				paths: [path],
			});
			await this.savePluginData();
			new Notice('URL imported to inbox.');
		} catch (error) {
			await this.captureError(error, 'URL import failed');
		}
	}

	async importFilesToInbox(files: FileList): Promise<void> {
		try {
			if (files.length === 0) {
				new Notice('Choose at least one file.');
				return;
			}
			const conversation = this.appendUserMessage(
				`Import ${files.length} file(s)`,
			);
			await ensureFolder(this.app, this.settings.inboxFolder);
			await ensureFolder(
				this.app,
				`${this.settings.inboxFolder}/attachments`,
			);
			const existingPaths = await getExistingPaths(this.app);
			const importedPaths: string[] = [];
			for (const file of Array.from(files)) {
				importedPaths.push(
					...(await this.importOneFile(file, existingPaths)),
				);
			}
			this.appendAssistantMessageToConversation(conversation.id, {
				text: `Imported ${importedPaths.length} item(s) into the inbox. Run "Organize my inbox" to generate proposals.`,
			});
			this.addAudit({
				action: 'import',
				message: `Imported ${files.length} file(s) into the inbox.`,
				paths: importedPaths,
			});
			await this.savePluginData();
			new Notice('Files imported to inbox.');
		} catch (error) {
			await this.captureError(error, 'File import failed');
		}
	}

	async applyProposal(proposalId: string): Promise<void> {
		const proposal = this.findProposal(proposalId);
		if (!proposal) {
			return;
		}
		try {
			const audit = await applyProposalToVault(
				this.app,
				proposal,
				this.settings.backupFolder,
			);
			proposal.status = 'applied';
			proposal.appliedAt = nowIso();
			this.state.auditLog.unshift(audit);
			await this.savePluginData();
			new Notice('Proposal applied. Backups were created first.');
		} catch (error) {
			proposal.status = 'failed';
			proposal.error = stringifyError(error);
			await this.captureError(
				error,
				`Apply failed for ${proposal.title}`,
				proposal.id,
			);
		}
	}

	async rejectProposal(proposalId: string): Promise<void> {
		const proposal = this.findProposal(proposalId);
		if (!proposal) {
			return;
		}
		proposal.status = 'rejected';
		proposal.rejectedAt = nowIso();
		this.addAudit({
			action: 'reject',
			message: `Rejected proposal: ${proposal.title}.`,
			proposalId,
		});
		await this.savePluginData();
	}

	async rollbackAppliedProposal(proposalId: string): Promise<void> {
		const proposal = this.findProposal(proposalId);
		if (!proposal || proposal.status !== 'applied') {
			new Notice('Only applied proposals can be rolled back.');
			return;
		}
		try {
			const audit = await rollbackProposal(this.app, proposal);
			proposal.status = 'pending';
			proposal.appliedAt = undefined;
			this.state.auditLog.unshift(audit);
			await this.savePluginData();
			new Notice('Rollback complete.');
		} catch (error) {
			await this.captureError(
				error,
				`Rollback failed for ${proposal.title}`,
				proposal.id,
			);
		}
	}

	async askVault(question: string): Promise<void> {
		const trimmed = question.trim();
		if (!trimmed) {
			return;
		}
		try {
			const conversation = this.appendUserMessage(trimmed);
			const providerSettings = this.getEffectiveSettings(conversation.id);
			const activeScopeFile =
				providerSettings.askScope === 'active'
					? this.app.workspace.getActiveFile()
					: null;
			const rawCitations = this.state.searchIndex
				? rankIndexedCandidates(trimmed, this.state.searchIndex, {
						limit: providerSettings.askSearchLimit,
					})
				: await findCandidates(
						this.app,
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
			this.state.lastAsk = askAnswer;
			this.appendAssistantMessageToConversation(conversation.id, {
				text: answer,
				citations: toCitationReferences(contextCitations),
			});
			this.addAudit({
				action: 'ask',
				message: `Answered vault question using ${contextCitations.length} citation(s).`,
				paths: contextCitations.map((candidate) => candidate.path),
			});
			await this.savePluginData();
		} catch (error) {
			await this.captureError(error, 'Ask Vault failed');
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
		const snapshot = await snapshotFile(this.app, activeFile);
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

	async rebuildSearchIndex(): Promise<void> {
		try {
			const conversation = this.appendUserMessage('Rebuild search index');
			const notes = await getAllMarkdownSnapshots(this.app);
			this.state.searchIndex = buildSearchIndex(notes);
			this.appendAssistantMessageToConversation(conversation.id, {
				text: `Rebuilt the search index over ${notes.length} note(s).`,
			});
			this.addAudit({
				action: 'index',
				message: `Rebuilt search index for ${notes.length} note(s).`,
			});
			await this.savePluginData();
			await this.activateView();
			new Notice('Search index rebuilt.');
		} catch (error) {
			await this.captureError(error, 'Search index rebuild failed');
		}
	}

	async runVaultAudit(): Promise<void> {
		try {
			const conversation = this.appendUserMessage(
				'Run a vault health audit',
			);
			const notes = await getAllMarkdownSnapshots(this.app);
			const report = buildHealthReport(notes);
			this.state.healthReport = report;
			const summary =
				report.issues.length === 0
					? `Checked ${report.noteCount} note(s); no health issues found.`
					: `Checked ${report.noteCount} note(s) and found ${report.issues.length} issue(s): orphans, duplicate titles, broken links, and missing frontmatter. Run "Create governance proposals" to fix them.`;
			this.appendAssistantMessageToConversation(conversation.id, {
				text: summary,
			});
			this.addAudit({
				action: 'health',
				message: `Vault audit found ${report.issues.length} issue(s) across ${report.noteCount} note(s).`,
			});
			await this.savePluginData();
			await this.activateView();
			new Notice('Vault audit complete.');
		} catch (error) {
			await this.captureError(error, 'Vault audit failed');
		}
	}

	async createGovernanceProposals(): Promise<void> {
		try {
			const conversation = this.appendUserMessage(
				'Create governance proposals',
			);
			const notes = await getAllMarkdownSnapshots(this.app);
			const proposals = buildGovernanceProposals(
				notes,
				await getExistingPaths(this.app),
			);
			if (proposals.length === 0) {
				this.appendAssistantMessageToConversation(conversation.id, {
					text: 'No governance proposals were needed — the vault structure looks healthy.',
				});
				await this.savePluginData();
				new Notice('No governance proposals were needed.');
				return;
			}
			this.state.proposals.unshift(...proposals);
			this.appendAssistantMessageToConversation(conversation.id, {
				text: `Created ${proposals.length} governance proposal(s) for index, tags, and duplicates. Review each below.`,
				proposalIds: proposals.map((proposal) => proposal.id),
			});
			this.addAudit({
				action: 'governance',
				message: `Created ${proposals.length} governance proposal(s).`,
				paths: proposals.flatMap((proposal) =>
					proposal.operations.map((operation) => operation.path),
				),
			});
			await this.savePluginData();
			await this.activateView();
			new Notice('Governance proposals created.');
		} catch (error) {
			await this.captureError(
				error,
				'Governance proposal creation failed',
			);
		}
	}

	async toggleOperation(
		proposalId: string,
		operationId: string,
		selected: boolean,
	): Promise<void> {
		this.state.proposals = this.state.proposals.map((proposal) =>
			proposal.id === proposalId
				? setOperationSelected(proposal, operationId, selected)
				: proposal,
		);
		await this.savePluginData();
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

	private addAudit(entry: Omit<AuditEntry, 'id' | 'at'>): void {
		this.state.auditLog.unshift({
			id: createId('audit'),
			at: nowIso(),
			...entry,
		});
		this.state.auditLog = this.state.auditLog.slice(0, 200);
	}

	private async captureError(
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

	private async importOneFile(
		file: File,
		existingPaths: Set<string>,
	): Promise<string[]> {
		const safeName = file.name.replace(/[\\/:*?"<>|]/gu, '-');
		const lowerName = safeName.toLowerCase();
		if (lowerName.endsWith('.md') || lowerName.endsWith('.txt')) {
			const path = uniquePath(
				`${this.settings.inboxFolder}/${safeName}`,
				existingPaths,
			);
			await this.app.vault.create(path, await file.text());
			existingPaths.add(path);
			return [path];
		}

		const attachmentPath = uniquePath(
			`${this.settings.inboxFolder}/attachments/${safeName}`,
			existingPaths,
		);
		const fileBuffer = await file.arrayBuffer();
		await this.app.vault.createBinary(attachmentPath, fileBuffer);
		existingPaths.add(attachmentPath);
		const extractedPdfText = lowerName.endsWith('.pdf')
			? extractPdfText(fileBuffer)
			: '';

		const sourceName = safeName.replace(/\.[^.]+$/u, '');
		const notePath = uniquePath(
			`${this.settings.inboxFolder}/${sourceName}.md`,
			existingPaths,
		);
		const note = [
			'---',
			`imported: ${nowIso()}`,
			`attachment: ${JSON.stringify(attachmentPath)}`,
			'tags:',
			'  - file-import',
			lowerName.endsWith('.pdf')
				? '  - pdf-import'
				: '  - attachment-import',
			'---',
			'',
			`# ${sourceName}`,
			'',
			`Imported attachment: [[${attachmentPath.replace(/\.md$/u, '')}]]`,
			'',
			buildFileImportBody(lowerName, extractedPdfText),
			'',
		].join('\n');
		await this.app.vault.create(notePath, note);
		existingPaths.add(notePath);
		return [attachmentPath, notePath];
	}
}

function buildFileImportBody(
	lowerName: string,
	extractedPdfText: string,
): string {
	if (!lowerName.endsWith('.pdf')) {
		return 'Attachment imported for review and linking.';
	}
	if (!extractedPdfText) {
		return 'No selectable PDF text could be extracted. The original PDF is preserved as an attachment for review and linking.';
	}
	return ['## Extracted text', '', extractedPdfText].join('\n');
}

class OrganizerView extends ItemView {
	private composerInput?: HTMLTextAreaElement;
	private modelPopoverEl?: HTMLElement;
	private modelPopoverTrigger?: HTMLElement;
	private modelPopoverCleanup?: () => void;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: AiKnowledgeOrganizerPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_AIKO;
	}

	getDisplayText(): string {
		return 'AI knowledge organizer';
	}

	getIcon(): string {
		return 'workflow';
	}

	async onOpen(): Promise<void> {
		this.plugin.setView(this);
		this.render();
	}

	async onClose(): Promise<void> {
		this.closeModelPopover();
		this.plugin.clearView(this);
	}

	focusAskInput(): void {
		this.composerInput?.focus();
	}

	render(): void {
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		if (!root) {
			return;
		}
		this.closeModelPopover();
		root.empty();
		root.addClass('aiko-view');

		this.renderTopbar(root);
		this.renderChat(root);
		this.renderComposer(root);
	}

	private renderTopbar(root: HTMLElement): void {
		const bar = root.createDiv({ cls: 'aiko-topbar' });
		const title = bar.createDiv({ cls: 'aiko-topbar-title' });
		title.createSpan({ cls: 'aiko-logo', text: '✦' });
		title.createSpan({ text: 'AI Organizer' });

		const pending = this.plugin.state.proposals.filter(
			(proposal) => proposal.status === 'pending',
		).length;
		if (pending > 0) {
			const badge = bar.createEl('button', {
				cls: 'aiko-pending-badge',
				attr: { 'aria-label': 'Open first pending proposal' },
			});
			badge.createSpan({ cls: 'aiko-pending-dot' });
			badge.createSpan({ text: `${pending} pending` });
			badge.addEventListener('click', () => {
				void this.plugin.openFirstPendingProposal();
			});
		}

		const newChat = bar.createEl('button', {
			cls: 'aiko-icon-btn',
			text: '＋',
			attr: { 'aria-label': 'New conversation' },
		});
		newChat.addEventListener('click', () => {
			void this.plugin.startNewConversation();
		});

		const history = bar.createEl('button', {
			cls: 'aiko-icon-btn',
			text: '🕘',
			attr: { 'aria-label': 'Conversation history and activity log' },
		});
		history.addEventListener('click', () => {
			new HistoryModal(this.plugin).open();
		});

		const settings = bar.createEl('button', {
			cls: 'aiko-icon-btn',
			text: '⚙',
			attr: { 'aria-label': 'Settings' },
		});
		settings.addEventListener('click', () => {
			const appWithSetting = this.app as unknown as {
				setting?: { open(): void; openTabById(id: string): void };
			};
			appWithSetting.setting?.open();
			appWithSetting.setting?.openTabById('ai-knowledge-organizer');
		});
	}

	private renderChat(root: HTMLElement): void {
		const conversation = this.plugin.getActiveConversation();
		const messages = conversation?.messages ?? [];

		if (messages.length === 0) {
			this.renderEmptyState(root);
			return;
		}

		const chat = root.createDiv({ cls: 'aiko-chat' });
		for (const message of messages) {
			if (message.role === 'user') {
				this.renderUserMessage(chat, message);
			} else if (message.role === 'assistant') {
				this.renderAssistantMessage(chat, message);
			} else {
				this.renderSystemMessage(chat, message);
			}
		}
		window.setTimeout(() => {
			chat.scrollTop = chat.scrollHeight;
		}, 0);
	}

	private renderUserMessage(parent: HTMLElement, message: ChatMessage): void {
		parent.createDiv({ cls: 'aiko-msg-user', text: message.text ?? '' });
	}

	private renderAssistantMessage(
		parent: HTMLElement,
		message: ChatMessage,
	): void {
		const wrap = parent.createDiv({ cls: 'aiko-msg-ai' });
		wrap.createSpan({ cls: 'aiko-msg-avatar', text: '✦' });
		const body = wrap.createDiv({ cls: 'aiko-msg-body' });
		if (message.text) {
			const textEl = body.createDiv({ cls: 'aiko-msg-text' });
			void MarkdownRenderer.render(
				this.app,
				sanitizeAssistantMarkdown(message.text),
				textEl,
				'',
				this,
			);
		}
		if (message.citations && message.citations.length > 0) {
			const cites = body.createDiv({ cls: 'aiko-citations' });
			for (const citation of message.citations) {
				const item = cites.createEl('button', {
					cls: 'aiko-link-button',
					text: citation.basename || citation.path,
				});
				item.addEventListener('click', () => {
					void this.app.workspace.openLinkText(
						citation.path,
						'',
						false,
					);
				});
			}
		}
		for (const id of message.proposalIds ?? []) {
			const proposal = this.plugin.findProposal(id);
			if (proposal) {
				this.renderProposal(body, proposal);
			}
		}
	}

	private renderSystemMessage(
		parent: HTMLElement,
		message: ChatMessage,
	): void {
		parent.createDiv({
			cls: `aiko-msg-system${message.kind === 'error' ? ' aiko-msg-error' : ''}`,
			text: message.text ?? '',
		});
	}

	private renderComposer(root: HTMLElement): void {
		const composer = root.createDiv({ cls: 'aiko-composer' });

		const input = composer.createEl('textarea', {
			cls: 'aiko-composer-input',
			attr: {
				rows: '2',
				'aria-label': 'Ask or instruct your vault',
				placeholder:
					'Ask or instruct your vault…  (Enter to send · Shift+Enter for newline)',
			},
		});
		this.composerInput = input;
		input.addEventListener('keydown', (event) => {
			if (event.isComposing) {
				return;
			}
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				this.submitComposer();
			}
		});

		const bar = composer.createDiv({ cls: 'aiko-composer-bar' });

		const modelPill = bar.createEl('button', {
			cls: 'aiko-pill',
			attr: { 'aria-haspopup': 'true', 'aria-expanded': 'false' },
		});
		modelPill.createSpan({ cls: 'aiko-pill-ic', text: '⚡' });
		modelPill.createSpan({
			text: providerLabel(this.plugin.getEffectiveSettings()),
		});
		modelPill.createSpan({ cls: 'aiko-pill-caret', text: '▾' });
		modelPill.addEventListener('click', (event) => {
			event.stopPropagation();
			this.toggleModelPopover(composer, modelPill);
		});

		const scopePill = bar.createEl('button', { cls: 'aiko-pill' });
		scopePill.createSpan({ cls: 'aiko-pill-ic', text: '📁' });
		scopePill.createSpan({
			text:
				this.plugin.settings.askScope === 'active'
					? 'Active note'
					: 'Whole vault',
		});
		scopePill.createSpan({ cls: 'aiko-pill-caret', text: '▾' });
		scopePill.addEventListener('click', () => {
			this.plugin.settings.askScope =
				this.plugin.settings.askScope === 'active' ? 'vault' : 'active';
			void this.plugin.savePluginData().then(() => this.render());
		});

		const send = bar.createEl('button', {
			cls: 'aiko-send',
			text: '↑',
			attr: { 'aria-label': 'Send' },
		});
		send.addEventListener('click', () => {
			this.submitComposer();
		});
	}

	private submitComposer(): void {
		const input = this.composerInput;
		if (!input) {
			return;
		}
		const value = input.value.trim();
		if (!value) {
			return;
		}
		input.value = '';
		this.routeInstruction(value);
	}

	private routeInstruction(text: string): void {
		if (text.startsWith('/')) {
			const command = text.slice(1).split(/\s+/u)[0]?.toLowerCase() ?? '';
			switch (command) {
				case 'scan':
					void this.plugin.scanInbox();
					return;
				case 'analyze':
					void this.plugin.analyzeActiveNote();
					return;
				case 'audit':
					void this.plugin.runVaultAudit();
					return;
				case 'govern':
				case 'governance':
					void this.plugin.createGovernanceProposals();
					return;
				case 'reindex':
					void this.plugin.rebuildSearchIndex();
					return;
				case 'import':
					new UrlImportModal(this.plugin, (url) => {
						void this.plugin.importUrlToInbox(url);
					}).open();
					return;
				default:
					new Notice(`Unknown command: /${command}`);
					return;
			}
		}
		void this.plugin.askVault(text);
	}

	private renderEmptyState(root: HTMLElement): void {
		const empty = root.createDiv({ cls: 'aiko-empty' });
		empty.createDiv({ cls: 'aiko-empty-logo', text: '✦' });
		empty.createEl('h2', { text: 'Tell me what to organize' });
		empty.createEl('p', {
			cls: 'aiko-muted',
			text: 'Every change is reviewed by you first and can be rolled back.',
		});

		const starters: Array<{
			icon: string;
			label: string;
			run: () => void;
		}> = [
			{
				icon: '📥',
				label: 'Organize my inbox',
				run: () => void this.plugin.scanInbox(),
			},
			{
				icon: '📝',
				label: 'Analyze the active note',
				run: () => void this.plugin.analyzeActiveNote(),
			},
			{
				icon: '🩺',
				label: 'Audit my vault health',
				run: () => void this.plugin.runVaultAudit(),
			},
			{
				icon: '🔍',
				label: 'Ask a question about my vault',
				run: () => this.focusAskInput(),
			},
		];
		const list = empty.createDiv({ cls: 'aiko-starters' });
		for (const starter of starters) {
			const chip = list.createEl('button', { cls: 'aiko-starter' });
			chip.createSpan({ cls: 'aiko-starter-ic', text: starter.icon });
			chip.createSpan({ text: starter.label });
			chip.addEventListener('click', starter.run);
		}
	}

	private closeModelPopover(): void {
		this.modelPopoverCleanup?.();
		this.modelPopoverCleanup = undefined;
		this.modelPopoverEl?.remove();
		this.modelPopoverEl = undefined;
		this.modelPopoverTrigger?.setAttribute('aria-expanded', 'false');
		this.modelPopoverTrigger = undefined;
	}

	private toggleModelPopover(anchor: HTMLElement, pill: HTMLElement): void {
		if (this.modelPopoverEl) {
			this.closeModelPopover();
			return;
		}
		pill.setAttribute('aria-expanded', 'true');
		this.modelPopoverTrigger = pill;
		const pop = anchor.createDiv({
			cls: 'aiko-model-pop',
			attr: { 'aria-label': 'Choose model for this conversation' },
		});
		this.modelPopoverEl = pop;
		const effectiveProvider = this.plugin.getEffectiveSettings().provider;
		for (const option of providerCatalog()) {
			const configured = isProviderConfigured(
				option.id,
				this.plugin.settings,
			);
			const active = option.id === effectiveProvider;
			const item = pop.createEl('button', {
				cls: `aiko-model-item${active ? ' is-active' : ''}${
					configured ? '' : ' is-disabled'
				}`,
				attr: {
					type: 'button',
					'aria-pressed': String(active),
					'aria-label': `${option.label}${active ? ', selected' : ''}${
						configured ? '' : ', needs setup'
					}`,
				},
			});
			item.disabled = !configured;
			item.createSpan({
				cls: 'aiko-model-check',
				text: active ? '✓' : '',
			});
			item.createSpan({ cls: 'aiko-model-label', text: option.label });
			item.createSpan({
				cls: 'aiko-model-prov',
				text: configured ? option.note : '⚠ needs setup',
			});
			if (!configured) {
				continue;
			}
			item.addEventListener('click', () => {
				const conversation = this.plugin.ensureActiveConversation();
				conversation.providerOverride =
					option.id === this.plugin.settings.provider
						? undefined
						: option.id;
				this.closeModelPopover();
				void this.plugin.savePluginData().then(() => this.render());
			});
		}
		const close = (event: MouseEvent) => {
			const target = event.target as Node;
			if (!pop.contains(target) && !pill.contains(target)) {
				this.closeModelPopover();
			}
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') {
				return;
			}
			event.preventDefault();
			this.closeModelPopover();
			pill.focus();
		};
		window.setTimeout(() => {
			if (this.modelPopoverEl !== pop) {
				return;
			}
			activeWindow.addEventListener('click', close);
			activeWindow.addEventListener('keydown', closeOnEscape);
			this.modelPopoverCleanup = () => {
				activeWindow.removeEventListener('click', close);
				activeWindow.removeEventListener('keydown', closeOnEscape);
			};
		}, 0);
	}

	scrollToProposal(proposalId: string): void {
		const target = this.containerEl.querySelector(
			`.aiko-proposal[data-proposal-id="${proposalId}"]`,
		);
		target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	private renderProposal(
		parent: HTMLElement,
		proposal: ChangeProposal,
	): void {
		const card = parent.createDiv({
			cls: `aiko-proposal aiko-proposal-${proposal.status}`,
			attr: { 'data-proposal-id': proposal.id },
		});
		const head = card.createDiv({ cls: 'aiko-proposal-head' });
		const title = head.createDiv();
		title.createEl('h4', { text: proposal.title });
		title.createEl('p', {
			text: `${proposal.status.toUpperCase()} · ${proposal.sourcePath} · ${new Date(
				proposal.createdAt,
			).toLocaleString()}`,
			cls: 'aiko-muted',
		});

		const actions = head.createDiv({ cls: 'aiko-actions' });
		if (proposal.status === 'pending' || proposal.status === 'failed') {
			const apply = actions.createEl('button', {
				text: 'Apply selected',
				cls: 'mod-cta',
			});
			apply.addEventListener('click', () => {
				void this.plugin.applyProposal(proposal.id);
			});

			const reject = actions.createEl('button', { text: 'Reject' });
			reject.addEventListener('click', () => {
				void this.plugin.rejectProposal(proposal.id);
			});
		}
		if (proposal.status === 'applied') {
			const rollback = actions.createEl('button', { text: 'Rollback' });
			rollback.addEventListener('click', () => {
				void this.plugin.rollbackAppliedProposal(proposal.id);
			});
		}

		card.createEl('p', { text: proposal.reason });
		if (proposal.error) {
			card.createEl('p', { text: proposal.error, cls: 'aiko-error' });
		}

		const rationale = card.createEl('details');
		rationale.createEl('summary', { text: 'Rationale' });
		const list = rationale.createEl('ul');
		for (const item of proposal.rationale) {
			list.createEl('li', { text: item });
		}

		for (const operation of proposal.operations) {
			this.renderOperation(card, proposal, operation);
		}
	}

	private renderOperation(
		parent: HTMLElement,
		proposal: ChangeProposal,
		operation: PatchOperation,
	): void {
		const operationEl = parent.createDiv({ cls: 'aiko-operation' });
		const row = operationEl.createDiv({ cls: 'aiko-operation-row' });
		const checkbox = activeDocument.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.checked = operation.selected;
		checkbox.disabled =
			proposal.status === 'applied' || proposal.status === 'rejected';
		checkbox.addEventListener('change', () => {
			void this.plugin.toggleOperation(
				proposal.id,
				operation.id,
				checkbox.checked,
			);
		});
		row.appendChild(checkbox);
		row.createEl('strong', {
			text: `${operation.type.toUpperCase()} ${operation.path}`,
		});
		row.createEl('span', { text: operation.summary, cls: 'aiko-muted' });

		const details = operationEl.createEl('details');
		details.createEl('summary', { text: 'Preview' });
		if (operation.type === 'update') {
			const diff = compactDiff(
				buildLineDiff(operation.before, operation.after),
			);
			const summary = summarizeDiff(diff);
			details.createEl('p', {
				text: `Unified diff preview: +${summary.added} / -${summary.removed}`,
				cls: 'aiko-muted',
			});
			this.renderDiff(details, diff);
			return;
		}
		const preview = details.createDiv({ cls: 'aiko-preview-grid' });
		const after = preview.createDiv();
		after.createEl('h5', { text: 'New file' });
		after.createEl('pre', { text: operation.after.slice(0, 6000) });
	}

	private renderDiff(
		parent: HTMLElement,
		lines: ReturnType<typeof buildLineDiff>,
	): void {
		const table = parent.createEl('table', { cls: 'aiko-diff-table' });
		const body = table.createEl('tbody');
		for (const line of lines.slice(0, 500)) {
			const row = body.createEl('tr', { cls: `aiko-diff-${line.type}` });
			row.createEl('td', {
				text: line.oldLine ? String(line.oldLine) : '',
				cls: 'aiko-diff-line-number',
			});
			row.createEl('td', {
				text: line.newLine ? String(line.newLine) : '',
				cls: 'aiko-diff-line-number',
			});
			row.createEl('td', {
				text:
					line.type === 'add'
						? '+'
						: line.type === 'remove'
							? '-'
							: ' ',
				cls: 'aiko-diff-marker',
			});
			row.createEl('td', {
				text: line.text,
				cls: 'aiko-diff-text',
			});
		}
	}
}

function stringifyError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
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

function toCitationReferences(citations: CandidateNote[]): CitationReference[] {
	return citations.map((citation) => ({
		path: citation.path,
		basename: citation.basename,
	}));
}

function sanitizeAssistantMarkdown(markdown: string): string {
	return markdown
		.replace(/!\[\[[^\]]+\]\]/gu, '[embed removed]')
		.replace(/!\[[^\]]*\]\([^)]*\)/gu, '[image removed]')
		.replace(
			/<\/?(?:script|iframe|object|embed|img|video|audio|source|link|meta|style)[^>]*>/giu,
			'',
		)
		.replace(/<[^>]+>/gu, '');
}

interface ProviderOption {
	id: ProviderId;
	label: string;
	note: string;
}

function providerCatalog(): ProviderOption[] {
	return [
		{ id: 'anthropic', label: 'Anthropic', note: 'Anthropic' },
		{ id: 'openai', label: 'OpenAI', note: 'OpenAI' },
		{ id: 'gemini', label: 'Gemini', note: 'Google' },
		{ id: 'deepseek', label: 'DeepSeek', note: 'DeepSeek' },
		{ id: 'ollama', label: 'Ollama', note: 'Local model' },
		{ id: 'heuristic', label: 'Local heuristic', note: 'No network' },
	];
}

function providerLabel(settings: OrganizerSettings): string {
	return (
		providerCatalog().find((option) => option.id === settings.provider)
			?.label ?? settings.provider
	);
}

function isProviderConfigured(
	id: ProviderId,
	settings: OrganizerSettings,
): boolean {
	switch (id) {
		case 'heuristic':
			return true;
		case 'openai':
			return settings.openaiApiKey.trim().length > 0;
		case 'anthropic':
			return settings.anthropicApiKey.trim().length > 0;
		case 'gemini':
			return settings.geminiApiKey.trim().length > 0;
		case 'deepseek':
			return settings.deepseekApiKey.trim().length > 0;
		case 'ollama':
			return settings.ollamaUrl.trim().length > 0;
		default:
			return false;
	}
}

class HistoryModal extends Modal {
	constructor(private readonly plugin: AiKnowledgeOrganizerPlugin) {
		super(plugin.app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Conversation history' });
		const conversations = this.plugin.state.conversations.slice(0, 50);
		if (conversations.length === 0) {
			contentEl.createEl('p', {
				cls: 'aiko-muted',
				text: 'No conversations yet.',
			});
		} else {
			const list = contentEl.createEl('ul', { cls: 'aiko-history-list' });
			for (const conversation of conversations) {
				const item = list.createEl('li');
				const button = item.createEl('button', {
					cls: 'aiko-history-item',
					text: `${
						conversation.id ===
						this.plugin.state.activeConversationId
							? '✓ '
							: ''
					}${conversation.title} · ${conversation.messages.length} message(s) · ${new Date(
						conversation.updatedAt,
					).toLocaleString()}`,
				});
				button.addEventListener('click', () => {
					void this.plugin.activateConversation(conversation.id);
					this.close();
				});
			}
		}

		contentEl.createEl('h3', { text: 'Activity log' });
		const entries = this.plugin.state.auditLog.slice(0, 50);
		if (entries.length === 0) {
			contentEl.createEl('p', {
				cls: 'aiko-muted',
				text: 'No actions recorded yet.',
			});
			return;
		}
		const list = contentEl.createEl('ul', { cls: 'aiko-audit' });
		for (const entry of entries) {
			list.createEl('li', {
				text: `${new Date(entry.at).toLocaleString()} · ${entry.action}: ${entry.message}`,
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class UrlImportModal extends Modal {
	constructor(
		private readonly plugin: AiKnowledgeOrganizerPlugin,
		private readonly onSubmit: (url: string) => void,
	) {
		super(plugin.app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Import URL to inbox' });
		contentEl.createEl('p', {
			text: 'Fetch a web page and save a Markdown copy into the configured inbox folder.',
			cls: 'aiko-muted',
		});
		const input = contentEl.createEl('input', {
			type: 'url',
			placeholder: 'https://example.com/article',
		});
		input.addClass('aiko-url-input');
		const actions = contentEl.createDiv({
			cls: 'aiko-actions aiko-modal-actions',
		});
		const cancel = actions.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => {
			this.close();
		});
		const submit = actions.createEl('button', {
			text: 'Import',
			cls: 'mod-cta',
		});
		const run = () => {
			const url = input.value.trim();
			if (!url) {
				new Notice('Enter a URL first.');
				return;
			}
			this.close();
			this.onSubmit(url);
		};
		submit.addEventListener('click', run);
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				run();
			}
		});
		input.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class FileImportModal extends Modal {
	constructor(
		private readonly plugin: AiKnowledgeOrganizerPlugin,
		private readonly onSubmit: (files: FileList) => void,
	) {
		super(plugin.app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Import files to inbox' });
		contentEl.createEl('p', {
			text: 'Import Markdown, text, PDF, or other files. PDF files are stored as attachments with a source note.',
			cls: 'aiko-muted',
		});
		const input = contentEl.createEl('input', {
			type: 'file',
		});
		input.multiple = true;
		input.addClass('aiko-url-input');
		const actions = contentEl.createDiv({
			cls: 'aiko-actions aiko-modal-actions',
		});
		const cancel = actions.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => {
			this.close();
		});
		const submit = actions.createEl('button', {
			text: 'Import',
			cls: 'mod-cta',
		});
		submit.addEventListener('click', () => {
			if (!input.files || input.files.length === 0) {
				new Notice('Choose at least one file.');
				return;
			}
			const files = input.files;
			this.close();
			this.onSubmit(files);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function uniquePath(path: string, existingPaths: Set<string>): string {
	if (!existingPaths.has(path)) {
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
	return candidate;
}
