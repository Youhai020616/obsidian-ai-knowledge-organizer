import { App, normalizePath, TFile } from 'obsidian';
import {
	AuditEntry,
	CandidateNote,
	ChangeProposal,
	NoteSnapshot,
	PatchOperation,
} from './types';
import { rankCandidates } from './retrieval';
import { createId, nowIso, selectedOperations } from './utils';

export async function getActiveMarkdownFile(app: App): Promise<TFile | null> {
	const file = app.workspace.getActiveFile();
	if (!file || file.extension !== 'md') {
		return null;
	}
	return file;
}

export async function snapshotFile(
	app: App,
	file: TFile,
): Promise<NoteSnapshot> {
	return {
		path: file.path,
		basename: file.basename,
		content: await app.vault.read(file),
	};
}

export async function snapshotPath(
	app: App,
	path: string,
): Promise<NoteSnapshot | null> {
	const file = app.vault.getAbstractFileByPath(normalizePath(path));
	if (!(file instanceof TFile) || file.extension !== 'md') {
		return null;
	}
	return snapshotFile(app, file);
}

export async function getAllMarkdownSnapshots(
	app: App,
): Promise<NoteSnapshot[]> {
	const files = app.vault.getMarkdownFiles();
	return Promise.all(files.map((file) => snapshotFile(app, file)));
}

export async function getExistingPaths(app: App): Promise<Set<string>> {
	return new Set(app.vault.getFiles().map((file) => file.path));
}

export async function findCandidates(
	app: App,
	query: string,
	excludePath?: string,
	limit = 8,
): Promise<CandidateNote[]> {
	const notes = await getAllMarkdownSnapshots(app);
	return rankCandidates(query, notes, { excludePath, limit });
}

export async function getInboxFiles(
	app: App,
	inboxFolder: string,
): Promise<TFile[]> {
	const prefix = normalizePath(inboxFolder).replace(/\/$/u, '');
	return app.vault
		.getMarkdownFiles()
		.filter(
			(file) =>
				file.path === `${prefix}.md` ||
				file.path.startsWith(`${prefix}/`),
		);
}

export async function ensureFolder(
	app: App,
	folderPath: string,
): Promise<void> {
	const normalized = normalizePath(folderPath);
	if (!normalized || normalized === '/') {
		return;
	}
	const parts = normalized.split('/').filter(Boolean);
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!(await app.vault.adapter.exists(current))) {
			await app.vault.createFolder(current);
		}
	}
}

export async function applyProposalToVault(
	app: App,
	proposal: ChangeProposal,
	backupFolder: string,
): Promise<AuditEntry> {
	const operations = selectedOperations(proposal);
	if (operations.length === 0) {
		throw new Error('No selected operations to apply.');
	}

	const timestamp = nowIso().replace(/[:.]/gu, '-');
	const touchedPaths: string[] = [];
	for (const operation of operations) {
		await applyOperation(app, operation, `${backupFolder}/${timestamp}`);
		touchedPaths.push(operation.path);
	}

	return {
		id: createId('audit'),
		at: nowIso(),
		action: 'apply',
		message: `Applied ${operations.length} operation(s).`,
		proposalId: proposal.id,
		paths: touchedPaths,
	};
}

export async function rollbackProposal(
	app: App,
	proposal: ChangeProposal,
): Promise<AuditEntry> {
	const operations = selectedOperations(proposal).reverse();
	const touchedPaths: string[] = [];

	for (const operation of operations) {
		const normalizedPath = normalizePath(operation.path);
		const target = app.vault.getAbstractFileByPath(normalizedPath);
		if (operation.type === 'create') {
			if (target instanceof TFile) {
				const current = await app.vault.read(target);
				if (current !== operation.after) {
					throw new Error(
						`Refusing to delete ${normalizedPath}; the file changed after this proposal was applied.`,
					);
				}
			}
			continue;
		}
		if (!operation.backupPath) {
			throw new Error(
				`Cannot roll back ${normalizedPath}; backup path is missing.`,
			);
		}
		if (!(target instanceof TFile)) {
			throw new Error(
				`Cannot roll back ${normalizedPath}; target file is missing.`,
			);
		}
		const backupPath = normalizePath(operation.backupPath);
		const backup = app.vault.getAbstractFileByPath(backupPath);
		if (!(backup instanceof TFile)) {
			throw new Error(
				`Cannot roll back ${normalizedPath}; backup file is missing.`,
			);
		}
		const current = await app.vault.read(target);
		if (current !== operation.after) {
			throw new Error(
				`Refusing to roll back ${normalizedPath}; the file changed after this proposal was applied.`,
			);
		}
	}

	for (const operation of operations) {
		const normalizedPath = normalizePath(operation.path);
		if (operation.type === 'create') {
			const file = app.vault.getAbstractFileByPath(normalizedPath);
			if (file instanceof TFile) {
				await app.vault.adapter.remove(normalizedPath);
			}
			touchedPaths.push(normalizedPath);
			continue;
		}
		if (!operation.backupPath) {
			throw new Error(
				`Cannot roll back ${normalizedPath}; backup path is missing.`,
			);
		}
		const backup = app.vault.getAbstractFileByPath(
			normalizePath(operation.backupPath),
		);
		const target = app.vault.getAbstractFileByPath(normalizedPath);
		if (!(backup instanceof TFile) || !(target instanceof TFile)) {
			throw new Error(
				`Cannot roll back ${normalizedPath}; rollback preflight no longer holds.`,
			);
		}
		await app.vault.modify(target, await app.vault.read(backup));
		touchedPaths.push(normalizedPath);
	}

	return {
		id: createId('audit'),
		at: nowIso(),
		action: 'rollback',
		message: `Rolled back ${touchedPaths.length} path(s).`,
		proposalId: proposal.id,
		paths: touchedPaths,
	};
}

async function applyOperation(
	app: App,
	operation: PatchOperation,
	backupRunFolder: string,
): Promise<void> {
	const normalizedPath = normalizePath(operation.path);
	await ensureFolderForFile(app, normalizedPath);

	if (operation.type === 'create') {
		if (await app.vault.adapter.exists(normalizedPath)) {
			throw new Error(
				`Cannot create ${normalizedPath}; file already exists.`,
			);
		}
		await app.vault.create(normalizedPath, operation.after);
		return;
	}

	const file = app.vault.getAbstractFileByPath(normalizedPath);
	if (!(file instanceof TFile)) {
		throw new Error(`Cannot update ${normalizedPath}; file not found.`);
	}
	const backupPath = normalizePath(
		`${backupRunFolder}/${encodePathForBackup(normalizedPath)}`,
	);
	await ensureFolderForFile(app, backupPath);
	await app.vault.create(backupPath, await app.vault.read(file));
	operation.backupPath = backupPath;
	await app.vault.modify(file, operation.after);
}

async function ensureFolderForFile(app: App, filePath: string): Promise<void> {
	const slash = filePath.lastIndexOf('/');
	if (slash <= 0) {
		return;
	}
	await ensureFolder(app, filePath.slice(0, slash));
}

function encodePathForBackup(path: string): string {
	return path.replace(/\//gu, '__');
}
