import {
	ItemView,
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
	ChangeProposal,
	OrganizerData,
	OrganizerSettings,
	OrganizerState,
	PatchOperation,
} from './types';
import {
	buildProposal,
	createId,
	nowIso,
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
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
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
		this.settings = {
			...DEFAULT_SETTINGS,
			...(loaded?.settings ?? {}),
		};
		this.state = {
			...DEFAULT_STATE,
			...(loaded?.state ?? {}),
			proposals: loaded?.state?.proposals ?? [],
			auditLog: loaded?.state?.auditLog ?? [],
		};
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
			await this.captureError(error, 'Inbox folder initialization failed');
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

	async analyzeActiveNote(): Promise<void> {
		const file = await getActiveMarkdownFile(this.app);
		if (!file) {
			new Notice('Open a Markdown note before analyzing.');
			return;
		}
		await this.analyzeFile(file);
	}

	async analyzeFile(file: TFile): Promise<ChangeProposal | null> {
		try {
			new Notice(`Analyzing ${file.basename}...`);
			const source = await snapshotFile(this.app, file);
			const candidates = await findCandidates(
				this.app,
				`${source.basename}\n${source.content}`,
				source.path,
				this.settings.askSearchLimit,
			);
			const provider = createProvider(this.settings);
			const analysis = await provider.analyze({
				source,
				candidates,
				settings: this.settings,
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
				paths: selectedOperations(proposal).map((operation) => operation.path),
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
			await ensureFolder(this.app, this.settings.inboxFolder);
			const files = await getInboxFiles(this.app, this.settings.inboxFolder);
			if (files.length === 0) {
				new Notice(`No Markdown files found in ${this.settings.inboxFolder}.`);
				return;
			}
			let created = 0;
			for (const file of files) {
				const proposal = await this.analyzeFile(file);
				if (proposal) {
					created += 1;
				}
			}
			this.addAudit({
				action: 'scan-inbox',
				message: `Scanned ${files.length} inbox file(s); created ${created} proposal(s).`,
				paths: files.map((file) => file.path),
			});
			await this.savePluginData();
		} catch (error) {
			await this.captureError(error, 'Inbox scan failed');
		}
	}

	async importUrlToInbox(url: string): Promise<void> {
		try {
			new Notice('Importing URL...');
			const page = await importUrlAsMarkdown(url);
			await ensureFolder(this.app, this.settings.inboxFolder);
			const existingPaths = await getExistingPaths(this.app);
			const path = uniquePath(
				`${this.settings.inboxFolder}/${page.fileName}`,
				existingPaths,
			);
			await this.app.vault.create(path, page.content);
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
			await ensureFolder(this.app, this.settings.inboxFolder);
			await ensureFolder(this.app, `${this.settings.inboxFolder}/attachments`);
			const existingPaths = await getExistingPaths(this.app);
			const importedPaths: string[] = [];
			for (const file of Array.from(files)) {
				importedPaths.push(...(await this.importOneFile(file, existingPaths)));
			}
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
			await this.captureError(error, `Apply failed for ${proposal.title}`, proposal.id);
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
			await this.captureError(error, `Rollback failed for ${proposal.title}`, proposal.id);
		}
	}

	async askVault(question: string): Promise<void> {
		const trimmed = question.trim();
		if (!trimmed) {
			return;
		}
		try {
			const citations = this.state.searchIndex
				? rankIndexedCandidates(trimmed, this.state.searchIndex, {
						limit: this.settings.askSearchLimit,
					})
				: await findCandidates(
						this.app,
						trimmed,
						undefined,
						this.settings.askSearchLimit,
					);
			const answer = await createProvider(this.settings).answer(trimmed, citations);
			const askAnswer: AskAnswer = {
				id: createId('ask'),
				question: trimmed,
				answer,
				citations,
				createdAt: nowIso(),
			};
			this.state.lastAsk = askAnswer;
			this.addAudit({
				action: 'ask',
				message: `Answered vault question using ${citations.length} citation(s).`,
				paths: citations.map((candidate) => candidate.path),
			});
			await this.savePluginData();
		} catch (error) {
			await this.captureError(error, 'Ask Vault failed');
		}
	}

	async rebuildSearchIndex(): Promise<void> {
		try {
			const notes = await getAllMarkdownSnapshots(this.app);
			this.state.searchIndex = buildSearchIndex(notes);
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
			const notes = await getAllMarkdownSnapshots(this.app);
			const report = buildHealthReport(notes);
			this.state.healthReport = report;
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
			const notes = await getAllMarkdownSnapshots(this.app);
			const proposals = buildGovernanceProposals(
				notes,
				await getExistingPaths(this.app),
			);
			if (proposals.length === 0) {
				new Notice('No governance proposals were needed.');
				return;
			}
			this.state.proposals.unshift(...proposals);
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
			await this.captureError(error, 'Governance proposal creation failed');
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
		return this.state.proposals.find((proposal) => proposal.id === proposalId);
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
			const path = uniquePath(`${this.settings.inboxFolder}/${safeName}`, existingPaths);
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
			lowerName.endsWith('.pdf') ? '  - pdf-import' : '  - attachment-import',
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

function buildFileImportBody(lowerName: string, extractedPdfText: string): string {
	if (!lowerName.endsWith('.pdf')) {
		return 'Attachment imported for review and linking.';
	}
	if (!extractedPdfText) {
		return 'No selectable PDF text could be extracted. The original PDF is preserved as an attachment for review and linking.';
	}
	return ['## Extracted text', '', extractedPdfText].join('\n');
}

class OrganizerView extends ItemView {
	private askInput?: HTMLInputElement;

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
		this.plugin.clearView(this);
	}

	focusAskInput(): void {
		this.askInput?.focus();
	}

	render(): void {
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		if (!root) {
			return;
		}
		root.empty();
		root.addClass('aiko-view');

		this.renderHeader(root);
		this.renderAsk(root);
		this.renderHealth(root);
		this.renderProposals(root);
		this.renderAudit(root);
	}

	private renderHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: 'aiko-header' });
		const title = header.createDiv();
		title.createEl('h2', { text: 'AI knowledge organizer' });
		title.createEl('p', {
			text: 'Review-first vault organization. AI proposes; you approve.',
			cls: 'aiko-muted',
		});

		const actions = header.createDiv({ cls: 'aiko-actions' });
		const analyze = actions.createEl('button', { text: 'Analyze active note' });
		analyze.addEventListener('click', () => {
			void this.plugin.analyzeActiveNote();
		});

		const scan = actions.createEl('button', { text: 'Scan inbox' });
		scan.addEventListener('click', () => {
			void this.plugin.scanInbox();
		});

		const importUrl = actions.createEl('button', { text: 'Import URL' });
		importUrl.addEventListener('click', () => {
			new UrlImportModal(this.plugin, (url) => {
				void this.plugin.importUrlToInbox(url);
			}).open();
		});

		const importFiles = actions.createEl('button', { text: 'Import files' });
		importFiles.addEventListener('click', () => {
			new FileImportModal(this.plugin, (files) => {
				void this.plugin.importFilesToInbox(files);
			}).open();
		});

		const index = actions.createEl('button', { text: 'Rebuild index' });
		index.addEventListener('click', () => {
			void this.plugin.rebuildSearchIndex();
		});

		const audit = actions.createEl('button', { text: 'Run vault audit' });
		audit.addEventListener('click', () => {
			void this.plugin.runVaultAudit();
		});

		const governance = actions.createEl('button', {
			text: 'Create governance proposals',
		});
		governance.addEventListener('click', () => {
			void this.plugin.createGovernanceProposals();
		});
	}

	private renderAsk(root: HTMLElement): void {
		const panel = root.createDiv({ cls: 'aiko-panel' });
		panel.createEl('h3', { text: 'Ask vault' });
		const form = panel.createDiv({ cls: 'aiko-ask-row' });
		this.askInput = form.createEl('input', {
			type: 'text',
			placeholder: 'Ask a question about your vault...',
		});
		const button = form.createEl('button', { text: 'Ask' });
		const ask = () => {
			const value = this.askInput?.value ?? '';
			void this.plugin.askVault(value);
		};
		button.addEventListener('click', ask);
		this.askInput.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				ask();
			}
		});

		if (this.plugin.state.searchIndex) {
			panel.createEl('p', {
				text: `Search index: ${this.plugin.state.searchIndex.noteCount} notes · ${new Date(
					this.plugin.state.searchIndex.builtAt,
				).toLocaleString()}`,
				cls: 'aiko-muted',
			});
		} else {
			panel.createEl('p', {
				text: 'Search index not built yet. Ask vault will scan files directly until you rebuild the index.',
				cls: 'aiko-muted',
			});
		}

		if (this.plugin.state.lastAsk) {
			const answer = panel.createDiv({ cls: 'aiko-answer' });
			answer.createEl('strong', { text: this.plugin.state.lastAsk.question });
			answer.createEl('p', { text: this.plugin.state.lastAsk.answer });
			const citations = answer.createDiv({ cls: 'aiko-citations' });
			for (const citation of this.plugin.state.lastAsk.citations) {
				const item = citations.createEl('button', {
					text: citation.path,
					cls: 'aiko-link-button',
				});
				item.addEventListener('click', () => {
					void this.app.workspace.openLinkText(citation.path, '', false);
				});
			}
		}
	}

	private renderProposals(root: HTMLElement): void {
		const section = root.createDiv({ cls: 'aiko-section' });
		const pendingCount = this.plugin.state.proposals.filter(
			(proposal) => proposal.status === 'pending',
		).length;
		section.createEl('h3', {
			text: `Review Queue (${pendingCount} pending)`,
		});

		if (this.plugin.state.proposals.length === 0) {
			section.createEl('p', {
				text: 'No proposals yet. Analyze the active note or scan your inbox folder.',
				cls: 'aiko-muted',
			});
			return;
		}

		for (const proposal of this.plugin.state.proposals) {
			this.renderProposal(section, proposal);
		}
	}

	private renderHealth(root: HTMLElement): void {
		const report = this.plugin.state.healthReport;
		const panel = root.createDiv({ cls: 'aiko-panel' });
		const head = panel.createDiv({ cls: 'aiko-proposal-head' });
		head.createEl('h3', { text: 'Vault audit' });
		const run = head.createEl('button', { text: 'Run audit' });
		run.addEventListener('click', () => {
			void this.plugin.runVaultAudit();
		});
		const proposals = head.createEl('button', {
			text: 'Create proposals',
		});
		proposals.addEventListener('click', () => {
			void this.plugin.createGovernanceProposals();
		});

		if (!report) {
			panel.createEl('p', {
				text: 'Run an audit to find orphan notes, broken wikilinks, duplicate titles, and missing frontmatter.',
				cls: 'aiko-muted',
			});
			return;
		}

		panel.createEl('p', {
			text: `${report.noteCount} notes · ${report.linkCount} links · ${report.tagCount} tags · ${report.issues.length} issues · ${new Date(
				report.createdAt,
			).toLocaleString()}`,
			cls: 'aiko-muted',
		});

		if (report.issues.length === 0) {
			panel.createEl('p', { text: 'No vault health issues found.' });
			return;
		}

		const list = panel.createEl('ul', { cls: 'aiko-health-list' });
		for (const issue of report.issues.slice(0, 30)) {
			const item = list.createEl('li', {
				cls: `aiko-health-${issue.severity}`,
			});
			item.createEl('strong', {
				text: `${issue.severity.toUpperCase()} · ${issue.type}`,
			});
			item.createSpan({ text: ` · ${issue.path}: ${issue.message}` });
		}
	}

	private renderProposal(parent: HTMLElement, proposal: ChangeProposal): void {
		const card = parent.createDiv({
			cls: `aiko-proposal aiko-proposal-${proposal.status}`,
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
		checkbox.disabled = proposal.status === 'applied' || proposal.status === 'rejected';
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
			const diff = compactDiff(buildLineDiff(operation.before, operation.after));
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

	private renderDiff(parent: HTMLElement, lines: ReturnType<typeof buildLineDiff>): void {
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
					line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ',
				cls: 'aiko-diff-marker',
			});
			row.createEl('td', {
				text: line.text,
				cls: 'aiko-diff-text',
			});
		}
	}

	private renderAudit(root: HTMLElement): void {
		const section = root.createDiv({ cls: 'aiko-section' });
		section.createEl('h3', { text: 'Audit log' });
		if (this.plugin.state.auditLog.length === 0) {
			section.createEl('p', {
				text: 'No actions recorded yet.',
				cls: 'aiko-muted',
			});
			return;
		}
		const list = section.createEl('ul', { cls: 'aiko-audit' });
		for (const entry of this.plugin.state.auditLog.slice(0, 20)) {
			list.createEl('li', {
				text: `${new Date(entry.at).toLocaleString()} · ${entry.action}: ${
					entry.message
				}`,
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
		const actions = contentEl.createDiv({ cls: 'aiko-actions aiko-modal-actions' });
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
		const actions = contentEl.createDiv({ cls: 'aiko-actions aiko-modal-actions' });
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
