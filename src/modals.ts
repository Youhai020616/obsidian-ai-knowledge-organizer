import { Modal, Notice } from 'obsidian';
import type AiKnowledgeOrganizerPlugin from './main';

export class HistoryModal extends Modal {
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

export class UrlImportModal extends Modal {
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

export class FileImportModal extends Modal {
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
