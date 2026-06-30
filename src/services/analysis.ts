import { Notice, TFile } from 'obsidian';
import type { OrganizerContext } from '../context';
import { createProvider } from '../providers';
import { buildProposal, redactSecrets, selectedOperations } from '../utils';
import {
	ensureFolder,
	findCandidates,
	getActiveMarkdownFile,
	getExistingPaths,
	getInboxFiles,
	snapshotFile,
} from '../vault';
import type { ChangeProposal, OrganizerSettings } from '../types';

export class AnalysisService {
	constructor(private readonly ctx: OrganizerContext) {}

	async analyzeActiveNote(): Promise<void> {
		const file = await getActiveMarkdownFile(this.ctx.app);
		if (!file) {
			new Notice('Open a Markdown note before analyzing.');
			return;
		}
		const conversation = this.ctx.appendUserMessage(
			`Analyze active note: ${file.basename}`,
		);
		const providerSettings = this.ctx.getEffectiveSettings(conversation.id);
		const proposal = await this.analyzeFile(file, providerSettings);
		this.ctx.appendAssistantMessageToConversation(
			conversation.id,
			proposal
				? {
						text: `Created an organization proposal for ${file.basename}. Review it below.`,
						proposalIds: [proposal.id],
					}
				: { text: `Could not create a proposal for ${file.basename}.` },
		);
		await this.ctx.savePluginData();
		await this.ctx.activateView();
	}

	async analyzeFile(
		file: TFile,
		providerSettings: OrganizerSettings,
	): Promise<ChangeProposal | null> {
		try {
			new Notice(`Analyzing ${file.basename}...`);
			const source = await snapshotFile(this.ctx.app, file);
			const candidates = await findCandidates(
				this.ctx.app,
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
				await getExistingPaths(this.ctx.app),
			);
			this.ctx.state.proposals.unshift(proposal);
			this.ctx.addAudit({
				action: 'analyze',
				message: `Created proposal for ${source.path}.`,
				proposalId: proposal.id,
				paths: selectedOperations(proposal).map(
					(operation) => operation.path,
				),
			});
			await this.ctx.savePluginData();
			await this.ctx.activateView();
			new Notice('Review proposal created.');
			return proposal;
		} catch (error) {
			await this.ctx.captureError(
				error,
				`Analyze failed for ${file.path}`,
			);
			return null;
		}
	}

	async scanInbox(): Promise<void> {
		try {
			const conversation = this.ctx.appendUserMessage('Organize my inbox');
			const providerSettings = this.ctx.getEffectiveSettings(
				conversation.id,
			);
			await ensureFolder(this.ctx.app, this.ctx.settings.inboxFolder);
			const files = await getInboxFiles(
				this.ctx.app,
				this.ctx.settings.inboxFolder,
			);
			if (files.length === 0) {
				this.ctx.appendAssistantMessageToConversation(conversation.id, {
					text: `No Markdown files found in ${this.ctx.settings.inboxFolder}.`,
				});
				await this.ctx.savePluginData();
				return;
			}
			const createdIds: string[] = [];
			for (const file of files) {
				const proposal = await this.analyzeFile(file, providerSettings);
				if (proposal) {
					createdIds.push(proposal.id);
				}
			}
			this.ctx.appendAssistantMessageToConversation(conversation.id, {
				text: `Scanned ${files.length} note(s) and created ${createdIds.length} proposal(s). Review each one below.`,
				proposalIds: createdIds,
			});
			this.ctx.addAudit({
				action: 'scan-inbox',
				message: `Scanned ${files.length} inbox file(s); created ${createdIds.length} proposal(s).`,
				paths: files.map((file) => file.path),
			});
			await this.ctx.savePluginData();
		} catch (error) {
			await this.ctx.captureError(error, 'Inbox scan failed');
		}
	}
}
