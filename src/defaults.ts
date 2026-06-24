import { OrganizerData, OrganizerSettings, OrganizerState } from './types';

export const DEFAULT_SETTINGS: OrganizerSettings = {
	provider: 'heuristic',
	openaiApiKey: '',
	openaiModel: 'gpt-5.5',
	anthropicApiKey: '',
	anthropicModel: 'claude-sonnet-4-5',
	geminiApiKey: '',
	geminiModel: 'gemini-2.5-flash',
	deepseekApiKey: '',
	deepseekModel: 'deepseek-v4-flash',
	deepseekBaseUrl: 'https://api.deepseek.com',
	ollamaUrl: 'http://127.0.0.1:11434',
	ollamaModel: 'llama3.2',
	inboxFolder: 'AI Inbox',
	backupFolder: '.ai-organizer/backups',
	logFolder: '.ai-organizer/logs',
	maxContextChars: 12000,
	askSearchLimit: 8,
	askScope: 'active',
	allowFullNoteContext: false,
	autoCreateInbox: true,
};

export const DEFAULT_STATE: OrganizerState = {
	proposals: [],
	auditLog: [],
	conversations: [],
};

export const DEFAULT_DATA: OrganizerData = {
	settings: DEFAULT_SETTINGS,
	state: DEFAULT_STATE,
};
