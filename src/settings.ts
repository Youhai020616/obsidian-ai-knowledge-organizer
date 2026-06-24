import { App, PluginSettingTab, Setting } from 'obsidian';
import AiKnowledgeOrganizerPlugin from './main';
import { DEFAULT_SETTINGS } from './defaults';
import { ProviderId } from './types';

export class OrganizerSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: AiKnowledgeOrganizerPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Provider and storage').setHeading();
		containerEl.createEl('p', {
			text: 'AI can propose vault changes, but every write stays behind review and rollback.',
			cls: 'aiko-settings-description',
		});

		new Setting(containerEl)
			.setName('Provider')
			.setDesc('Use local heuristic mode for private dry runs, cloud providers for model-generated proposals, or local models.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('heuristic', 'Local heuristic')
					.addOption('openai', 'OpenAI')
					.addOption('anthropic', 'Anthropic')
					.addOption('gemini', 'Gemini')
					.addOption('deepseek', 'Deepseek')
					.addOption('ollama', 'Ollama')
					.setValue(this.plugin.settings.provider)
					.onChange(async (value) => {
						this.plugin.settings.provider = value as ProviderId;
						await this.plugin.savePluginData();
					}),
			);

		new Setting(containerEl)
			.setName('OpenAI API key')
			.setDesc('Stored locally in Obsidian plugin data. Leave empty to fall back to local heuristic mode.')
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('API key')
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiApiKey = value.trim();
						await this.plugin.savePluginData();
					});
			});

		new Setting(containerEl)
			.setName('OpenAI model')
			.setDesc('Responses API model used for analysis and ask vault.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.openaiModel)
					.setValue(this.plugin.settings.openaiModel)
					.onChange(async (value) => {
						this.plugin.settings.openaiModel =
							value.trim() || DEFAULT_SETTINGS.openaiModel;
						await this.plugin.savePluginData();
					}),
			);

		new Setting(containerEl)
			.setName('Anthropic API key')
			.setDesc('Stored locally in Obsidian plugin data. Leave empty to fall back to local heuristic mode.')
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('API key')
					.setValue(this.plugin.settings.anthropicApiKey)
					.onChange(async (value) => {
						this.plugin.settings.anthropicApiKey = value.trim();
						await this.plugin.savePluginData();
					});
			});

		new Setting(containerEl)
			.setName('Anthropic model')
			.setDesc('Messages API model used for analysis and ask vault.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.anthropicModel)
					.setValue(this.plugin.settings.anthropicModel)
					.onChange(async (value) => {
						this.plugin.settings.anthropicModel =
							value.trim() || DEFAULT_SETTINGS.anthropicModel;
						await this.plugin.savePluginData();
					}),
			);

		new Setting(containerEl)
			.setName('Gemini API key')
			.setDesc('Stored locally in Obsidian plugin data. Leave empty to fall back to local heuristic mode.')
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('API key')
					.setValue(this.plugin.settings.geminiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.geminiApiKey = value.trim();
						await this.plugin.savePluginData();
					});
			});

		new Setting(containerEl)
			.setName('Gemini model')
			.setDesc('Google Gemini model used for analysis and ask vault.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.geminiModel)
					.setValue(this.plugin.settings.geminiModel)
					.onChange(async (value) => {
						this.plugin.settings.geminiModel =
							value.trim() || DEFAULT_SETTINGS.geminiModel;
						await this.plugin.savePluginData();
					}),
			);

		new Setting(containerEl)
			.setName('Deepseek API key')
			.setDesc('Stored locally in Obsidian plugin data. Leave empty to fall back to local heuristic mode.')
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('API key')
					.setValue(this.plugin.settings.deepseekApiKey)
					.onChange(async (value) => {
						this.plugin.settings.deepseekApiKey = value.trim();
						await this.plugin.savePluginData();
					});
			});

		new Setting(containerEl)
			.setName('Deepseek model')
			.setDesc('Chat completions model used for analysis and ask vault.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.deepseekModel)
					.setValue(this.plugin.settings.deepseekModel)
					.onChange(async (value) => {
						this.plugin.settings.deepseekModel =
							value.trim() || DEFAULT_SETTINGS.deepseekModel;
						await this.plugin.savePluginData();
					}),
			);

		new Setting(containerEl)
			.setName('Deepseek base URL')
			.setDesc('OpenAI-compatible deepseek API base URL.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.deepseekBaseUrl)
					.setValue(this.plugin.settings.deepseekBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.deepseekBaseUrl =
							value.trim() || DEFAULT_SETTINGS.deepseekBaseUrl;
						await this.plugin.savePluginData();
					}),
			);

		new Setting(containerEl)
			.setName('Ollama URL')
			.setDesc('Local ollama server URL. The default is the standard localhost endpoint.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.ollamaUrl)
					.setValue(this.plugin.settings.ollamaUrl)
					.onChange(async (value) => {
						this.plugin.settings.ollamaUrl =
							value.trim() || DEFAULT_SETTINGS.ollamaUrl;
						await this.plugin.savePluginData();
					}),
			);

		new Setting(containerEl)
			.setName('Ollama model')
			.setDesc('Local model name to use for ollama generation.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.ollamaModel)
					.setValue(this.plugin.settings.ollamaModel)
					.onChange(async (value) => {
						this.plugin.settings.ollamaModel =
							value.trim() || DEFAULT_SETTINGS.ollamaModel;
						await this.plugin.savePluginData();
					}),
			);

		new Setting(containerEl)
			.setName('Inbox folder')
			.setDesc('Markdown files in this folder can be scanned into the review queue.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.inboxFolder)
					.setValue(this.plugin.settings.inboxFolder)
					.onChange(async (value) => {
						this.plugin.settings.inboxFolder =
							value.trim() || DEFAULT_SETTINGS.inboxFolder;
						await this.plugin.savePluginData();
					}),
			);

		new Setting(containerEl)
			.setName('Backup folder')
			.setDesc('Original files are copied here before any accepted update is written.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.backupFolder)
					.setValue(this.plugin.settings.backupFolder)
					.onChange(async (value) => {
						this.plugin.settings.backupFolder =
							value.trim() || DEFAULT_SETTINGS.backupFolder;
						await this.plugin.savePluginData();
					}),
			);

		new Setting(containerEl)
			.setName('Maximum context characters')
			.setDesc('Caps each note before sending it to a remote model.')
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.maxContextChars))
					.setValue(String(this.plugin.settings.maxContextChars))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						this.plugin.settings.maxContextChars = Number.isFinite(parsed)
							? Math.max(1000, parsed)
							: DEFAULT_SETTINGS.maxContextChars;
						await this.plugin.savePluginData();
					}),
			);

		new Setting(containerEl)
			.setName('Ask vault search limit')
			.setDesc('Number of local notes retrieved before the provider answers.')
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.askSearchLimit))
					.setValue(String(this.plugin.settings.askSearchLimit))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						this.plugin.settings.askSearchLimit = Number.isFinite(parsed)
							? Math.max(1, Math.min(20, parsed))
							: DEFAULT_SETTINGS.askSearchLimit;
						await this.plugin.savePluginData();
					}),
			);

		new Setting(containerEl)
			.setName('Auto-create inbox folder')
			.setDesc('Create the configured inbox folder on plugin load if it does not exist.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoCreateInbox)
					.onChange(async (value) => {
						this.plugin.settings.autoCreateInbox = value;
						await this.plugin.savePluginData();
					}),
			);
	}
}
