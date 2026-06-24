export type ProviderId =
	| 'heuristic'
	| 'openai'
	| 'anthropic'
	| 'gemini'
	| 'deepseek'
	| 'ollama';

export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'failed';

export interface OrganizerSettings {
	provider: ProviderId;
	openaiApiKey: string;
	openaiModel: string;
	anthropicApiKey: string;
	anthropicModel: string;
	geminiApiKey: string;
	geminiModel: string;
	deepseekApiKey: string;
	deepseekModel: string;
	deepseekBaseUrl: string;
	ollamaUrl: string;
	ollamaModel: string;
	inboxFolder: string;
	backupFolder: string;
	logFolder: string;
	maxContextChars: number;
	askSearchLimit: number;
	askScope: 'active' | 'vault';
	allowFullNoteContext: boolean;
	autoCreateInbox: boolean;
}

export interface OrganizerData {
	settings: OrganizerSettings;
	state: OrganizerState;
}

export interface OrganizerState {
	proposals: ChangeProposal[];
	auditLog: AuditEntry[];
	conversations: Conversation[];
	activeConversationId?: string;
	lastAsk?: AskAnswer;
	healthReport?: HealthReport;
	searchIndex?: SearchIndex;
}

export type ChatMessageRole = 'user' | 'assistant' | 'system';

/**
 * A single turn in a conversation. `proposalIds` references entries in
 * OrganizerState.proposals (the source of truth) — messages never copy
 * proposal data, so apply/reject/rollback keep working unchanged.
 */
export interface ChatMessage {
	id: string;
	role: ChatMessageRole;
	at: string;
	text?: string;
	citations?: CandidateNote[];
	proposalIds?: string[];
	kind?: 'progress' | 'error';
}

export interface Conversation {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messages: ChatMessage[];
}

export interface NoteSnapshot {
	path: string;
	basename: string;
	content: string;
}

export interface CandidateNote {
	path: string;
	basename: string;
	score: number;
	excerpt: string;
}

export interface SearchIndex {
	builtAt: string;
	noteCount: number;
	entries: SearchIndexEntry[];
}

export interface SearchIndexEntry {
	path: string;
	basename: string;
	excerpt: string;
	length: number;
	terms: Record<string, number>;
	titleTerms: string[];
}

export interface AnalysisInput {
	source: NoteSnapshot;
	candidates: CandidateNote[];
	settings: OrganizerSettings;
}

export interface AnalysisResult {
	title: string;
	summary: string;
	tags: string[];
	suggestedLinks: string[];
	frontmatter: Record<string, string | string[]>;
	appendSections: AppendSection[];
	newNotes: NewNoteSuggestion[];
	rationale: string[];
}

export interface AppendSection {
	heading: string;
	content: string;
}

export interface NewNoteSuggestion {
	title: string;
	path?: string;
	content: string;
	reason: string;
}

export interface ChangeProposal {
	id: string;
	title: string;
	sourcePath: string;
	createdAt: string;
	status: ProposalStatus;
	reason: string;
	operations: PatchOperation[];
	rationale: string[];
	error?: string;
	appliedAt?: string;
	rejectedAt?: string;
}

export type PatchOperation = UpdateOperation | CreateOperation;

export interface BaseOperation {
	id: string;
	path: string;
	summary: string;
	selected: boolean;
}

export interface UpdateOperation extends BaseOperation {
	type: 'update';
	before: string;
	after: string;
	backupPath?: string;
}

export interface CreateOperation extends BaseOperation {
	type: 'create';
	after: string;
}

export interface AuditEntry {
	id: string;
	at: string;
	action:
		| 'analyze'
		| 'scan-inbox'
		| 'apply'
		| 'reject'
		| 'rollback'
		| 'ask'
		| 'health'
		| 'governance'
		| 'import'
		| 'index'
		| 'error';
	message: string;
	proposalId?: string;
	paths?: string[];
}

export interface AskAnswer {
	id: string;
	question: string;
	answer: string;
	citations: CandidateNote[];
	createdAt: string;
}

export interface HealthReport {
	id: string;
	createdAt: string;
	noteCount: number;
	tagCount: number;
	linkCount: number;
	issues: HealthIssue[];
}

export interface HealthIssue {
	id: string;
	type: 'orphan' | 'duplicate-title' | 'broken-link' | 'missing-frontmatter';
	severity: 'low' | 'medium' | 'high';
	path: string;
	message: string;
	relatedPaths?: string[];
}

export interface ChatTurn {
	role: 'user' | 'assistant';
	text: string;
}

export interface Provider {
	analyze(input: AnalysisInput): Promise<AnalysisResult>;
	answer(
		question: string,
		candidates: CandidateNote[],
		history?: ChatTurn[],
	): Promise<string>;
}
