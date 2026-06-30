import { Notice } from 'obsidian';
import type { OrganizerContext } from '../context';
import { buildGovernanceProposals } from '../governance';
import { buildHealthReport } from '../health';
import { buildSearchIndex } from '../retrieval';
import { getAllMarkdownSnapshots, getExistingPaths } from '../vault';

export class MaintenanceService {
	constructor(private readonly ctx: OrganizerContext) {}

	async rebuildSearchIndex(): Promise<void> {
		try {
			const conversation =
				this.ctx.appendUserMessage('Rebuild search index');
			const notes = await getAllMarkdownSnapshots(this.ctx.app);
			this.ctx.state.searchIndex = buildSearchIndex(notes);
			this.ctx.appendAssistantMessageToConversation(conversation.id, {
				text: `Rebuilt the search index over ${notes.length} note(s).`,
			});
			this.ctx.addAudit({
				action: 'index',
				message: `Rebuilt search index for ${notes.length} note(s).`,
			});
			await this.ctx.savePluginData();
			await this.ctx.activateView();
			new Notice('Search index rebuilt.');
		} catch (error) {
			await this.ctx.captureError(error, 'Search index rebuild failed');
		}
	}

	async runVaultAudit(): Promise<void> {
		try {
			const conversation = this.ctx.appendUserMessage(
				'Run a vault health audit',
			);
			const notes = await getAllMarkdownSnapshots(this.ctx.app);
			const report = buildHealthReport(notes);
			this.ctx.state.healthReport = report;
			const summary =
				report.issues.length === 0
					? `Checked ${report.noteCount} note(s); no health issues found.`
					: `Checked ${report.noteCount} note(s) and found ${report.issues.length} issue(s): orphans, duplicate titles, broken links, and missing frontmatter. Run "Create governance proposals" to fix them.`;
			this.ctx.appendAssistantMessageToConversation(conversation.id, {
				text: summary,
			});
			this.ctx.addAudit({
				action: 'health',
				message: `Vault audit found ${report.issues.length} issue(s) across ${report.noteCount} note(s).`,
			});
			await this.ctx.savePluginData();
			await this.ctx.activateView();
			new Notice('Vault audit complete.');
		} catch (error) {
			await this.ctx.captureError(error, 'Vault audit failed');
		}
	}

	async createGovernanceProposals(): Promise<void> {
		try {
			const conversation = this.ctx.appendUserMessage(
				'Create governance proposals',
			);
			const notes = await getAllMarkdownSnapshots(this.ctx.app);
			const proposals = buildGovernanceProposals(
				notes,
				await getExistingPaths(this.ctx.app),
			);
			if (proposals.length === 0) {
				this.ctx.appendAssistantMessageToConversation(conversation.id, {
					text: 'No governance proposals were needed — the vault structure looks healthy.',
				});
				await this.ctx.savePluginData();
				new Notice('No governance proposals were needed.');
				return;
			}
			this.ctx.state.proposals.unshift(...proposals);
			this.ctx.appendAssistantMessageToConversation(conversation.id, {
				text: `Created ${proposals.length} governance proposal(s) for index, tags, and duplicates. Review each below.`,
				proposalIds: proposals.map((proposal) => proposal.id),
			});
			this.ctx.addAudit({
				action: 'governance',
				message: `Created ${proposals.length} governance proposal(s).`,
				paths: proposals.flatMap((proposal) =>
					proposal.operations.map((operation) => operation.path),
				),
			});
			await this.ctx.savePluginData();
			await this.ctx.activateView();
			new Notice('Governance proposals created.');
		} catch (error) {
			await this.ctx.captureError(
				error,
				'Governance proposal creation failed',
			);
		}
	}
}
