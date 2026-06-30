import { Notice } from 'obsidian';
import type { OrganizerContext } from '../context';
import { stringifyError } from '../errors';
import { nowIso, setOperationSelected } from '../utils';
import { applyProposalToVault, rollbackProposal } from '../vault';

export class ProposalService {
	constructor(private readonly ctx: OrganizerContext) {}

	async applyProposal(proposalId: string): Promise<void> {
		const proposal = this.ctx.findProposal(proposalId);
		if (!proposal) {
			return;
		}
		try {
			const audit = await applyProposalToVault(
				this.ctx.app,
				proposal,
				this.ctx.settings.backupFolder,
			);
			proposal.status = 'applied';
			proposal.appliedAt = nowIso();
			this.ctx.state.auditLog.unshift(audit);
			await this.ctx.savePluginData();
			new Notice('Proposal applied. Backups were created first.');
		} catch (error) {
			proposal.status = 'failed';
			proposal.error = stringifyError(error);
			await this.ctx.captureError(
				error,
				`Apply failed for ${proposal.title}`,
				proposal.id,
			);
		}
	}

	async rejectProposal(proposalId: string): Promise<void> {
		const proposal = this.ctx.findProposal(proposalId);
		if (!proposal) {
			return;
		}
		proposal.status = 'rejected';
		proposal.rejectedAt = nowIso();
		this.ctx.addAudit({
			action: 'reject',
			message: `Rejected proposal: ${proposal.title}.`,
			proposalId,
		});
		await this.ctx.savePluginData();
	}

	async rollbackAppliedProposal(proposalId: string): Promise<void> {
		const proposal = this.ctx.findProposal(proposalId);
		if (!proposal || proposal.status !== 'applied') {
			new Notice('Only applied proposals can be rolled back.');
			return;
		}
		try {
			const audit = await rollbackProposal(this.ctx.app, proposal);
			proposal.status = 'pending';
			proposal.appliedAt = undefined;
			this.ctx.state.auditLog.unshift(audit);
			await this.ctx.savePluginData();
			new Notice('Rollback complete.');
		} catch (error) {
			await this.ctx.captureError(
				error,
				`Rollback failed for ${proposal.title}`,
				proposal.id,
			);
		}
	}

	async toggleOperation(
		proposalId: string,
		operationId: string,
		selected: boolean,
	): Promise<void> {
		this.ctx.state.proposals = this.ctx.state.proposals.map((proposal) =>
			proposal.id === proposalId
				? setOperationSelected(proposal, operationId, selected)
				: proposal,
		);
		await this.ctx.savePluginData();
	}
}
