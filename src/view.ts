import { ItemView, MarkdownRenderer, Notice, WorkspaceLeaf } from 'obsidian';
import { buildLineDiff, compactDiff, summarizeDiff } from './diff';
import { HistoryModal, UrlImportModal } from './modals';
import {
	ChangeProposal,
	ChatMessage,
	OrganizerSettings,
	PatchOperation,
	ProviderId,
} from './types';
import type AiKnowledgeOrganizerPlugin from './main';

export const VIEW_TYPE_AIKO = 'aiko-review-view';

export class OrganizerView extends ItemView {
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
