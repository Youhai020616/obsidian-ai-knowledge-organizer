import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import {
	applyProposalToVault,
	ensureFolder,
	getExistingPaths,
	rollbackProposal,
} from '../src/vault';
import { ChangeProposal } from '../src/types';

describe('vault writes', () => {
	it('applies selected operations with backups and rolls them back', async () => {
		const app = createMemoryApp({
			'Inbox/source.md': '# Source\n\nOriginal content.',
			'Inbox/ignored.md': '# Ignored',
		});
		const proposal = createProposal();

		const audit = await applyProposalToVault(
			app,
			proposal,
			'.ai-organizer/backups',
		);

		expect(audit.action).toBe('apply');
		expect(audit.paths).toEqual([
			'Inbox/source.md',
			'AI Notes/new-topic.md',
		]);
		expect(await app.vault.readPath('Inbox/source.md')).toContain(
			'Updated content.',
		);
		expect(await app.vault.readPath('AI Notes/new-topic.md')).toContain(
			'Extracted note.',
		);
		expect(await app.vault.readPath('Inbox/ignored.md')).toBe('# Ignored');

		const updateOperation = proposal.operations[0];
		expect(updateOperation?.type).toBe('update');
		if (updateOperation?.type !== 'update') {
			throw new Error('Expected first operation to be an update.');
		}
		expect(updateOperation.backupPath).toMatch(
			/^\.ai-organizer\/backups\/.+\/Inbox__source\.md$/u,
		);
		expect(await app.vault.readPath(updateOperation.backupPath ?? '')).toBe(
			'# Source\n\nOriginal content.',
		);

		const rollback = await rollbackProposal(app, proposal);

		expect(rollback.action).toBe('rollback');
		expect(rollback.paths).toEqual([
			'AI Notes/new-topic.md',
			'Inbox/source.md',
		]);
		expect(await app.vault.readPath('Inbox/source.md')).toBe(
			'# Source\n\nOriginal content.',
		);
		expect(await app.vault.exists('AI Notes/new-topic.md')).toBe(false);
	});

	it('refuses to delete created files changed after apply', async () => {
		const app = createMemoryApp({
			'Inbox/source.md': '# Source\n\nOriginal content.',
		});
		const proposal = createProposal();

		await applyProposalToVault(app, proposal, '.ai-organizer/backups');
		const created = app.vault.getAbstractFileByPath(
			'AI Notes/new-topic.md',
		);
		if (!(created instanceof TFile)) {
			throw new Error('Expected created note.');
		}
		await app.vault.modify(created, '# New Topic\n\nUser edit.');

		await expect(rollbackProposal(app, proposal)).rejects.toThrow(
			/Refusing to delete/u,
		);
		expect(await app.vault.readPath('AI Notes/new-topic.md')).toContain(
			'User edit',
		);
	});

	it('refuses to overwrite updated files changed after apply', async () => {
		const app = createMemoryApp({
			'Inbox/source.md': '# Source\n\nOriginal content.',
		});
		const proposal = createProposal();

		await applyProposalToVault(app, proposal, '.ai-organizer/backups');
		const updated = app.vault.getAbstractFileByPath('Inbox/source.md');
		if (!(updated instanceof TFile)) {
			throw new Error('Expected updated note.');
		}
		await app.vault.modify(updated, '# Source\n\nUser edit.');

		await expect(rollbackProposal(app, proposal)).rejects.toThrow(
			/Refusing to roll back/u,
		);
		expect(await app.vault.readPath('Inbox/source.md')).toContain(
			'User edit',
		);
		expect(await app.vault.exists('AI Notes/new-topic.md')).toBe(true);
	});

	it('refuses rollback when an updated target file is missing', async () => {
		const app = createMemoryApp({
			'Inbox/source.md': '# Source\n\nOriginal content.',
		});
		const proposal = createProposal();

		await applyProposalToVault(app, proposal, '.ai-organizer/backups');
		await app.vault.adapter.remove('Inbox/source.md');

		await expect(rollbackProposal(app, proposal)).rejects.toThrow(
			/target file is missing/u,
		);
		expect(await app.vault.exists('AI Notes/new-topic.md')).toBe(true);
	});

	it('refuses rollback when an update backup file is missing', async () => {
		const app = createMemoryApp({
			'Inbox/source.md': '# Source\n\nOriginal content.',
		});
		const proposal = createProposal();

		await applyProposalToVault(app, proposal, '.ai-organizer/backups');
		const updateOperation = proposal.operations[0];
		if (updateOperation?.type !== 'update' || !updateOperation.backupPath) {
			throw new Error('Expected update backup path.');
		}
		await app.vault.adapter.remove(updateOperation.backupPath);

		await expect(rollbackProposal(app, proposal)).rejects.toThrow(
			/backup file is missing/u,
		);
		expect(await app.vault.readPath('Inbox/source.md')).toContain(
			'Updated content',
		);
		expect(await app.vault.exists('AI Notes/new-topic.md')).toBe(true);
	});

	it('creates nested folders idempotently and reports existing paths', async () => {
		const app = createMemoryApp({
			'Existing/note.md': '# Existing',
		});

		await ensureFolder(app, 'A/B/C');
		await ensureFolder(app, 'A/B/C');
		const paths = await getExistingPaths(app);

		expect(await app.vault.adapter.exists('A')).toBe(true);
		expect(await app.vault.adapter.exists('A/B')).toBe(true);
		expect(await app.vault.adapter.exists('A/B/C')).toBe(true);
		expect(paths.has('Existing/note.md')).toBe(true);
	});
});

type TestApp = App & { vault: MemoryVault };

class MemoryVault {
	readonly adapter = {
		exists: async (path: string): Promise<boolean> =>
			this.files.has(path) || this.folders.has(path),
		remove: async (path: string): Promise<void> => {
			this.files.delete(path);
		},
	};

	private readonly files = new Map<string, string>();
	private readonly folders = new Set<string>();

	constructor(initialFiles: Record<string, string>) {
		for (const [path, content] of Object.entries(initialFiles)) {
			this.files.set(path, content);
			this.recordParentFolders(path);
		}
	}

	getAbstractFileByPath(path: string): TFile | null {
		return this.files.has(path) ? createTFile(path) : null;
	}

	getFiles(): TFile[] {
		return Array.from(this.files.keys()).map((path) => createTFile(path));
	}

	getMarkdownFiles(): TFile[] {
		return this.getFiles().filter((file) => file.extension === 'md');
	}

	async read(file: TFile): Promise<string> {
		return this.readPath(file.path);
	}

	async readPath(path: string): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) {
			throw new Error(`Missing file: ${path}`);
		}
		return content;
	}

	async create(path: string, content: string): Promise<TFile> {
		if (this.files.has(path)) {
			throw new Error(`File already exists: ${path}`);
		}
		this.recordParentFolders(path);
		this.files.set(path, content);
		return createTFile(path);
	}

	async createFolder(path: string): Promise<void> {
		this.folders.add(path);
	}

	async modify(file: TFile, content: string): Promise<void> {
		if (!this.files.has(file.path)) {
			throw new Error(`Missing file: ${file.path}`);
		}
		this.files.set(file.path, content);
	}

	async exists(path: string): Promise<boolean> {
		return this.adapter.exists(path);
	}

	private recordParentFolders(filePath: string): void {
		const parts = filePath.split('/').slice(0, -1);
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			this.folders.add(current);
		}
	}
}

function createMemoryApp(initialFiles: Record<string, string>): TestApp {
	return {
		vault: new MemoryVault(initialFiles),
	} as unknown as TestApp;
}

function createTFile(path: string): TFile {
	const file = new TFile();
	(file as unknown as { path: string }).path = path;
	return file;
}

function createProposal(): ChangeProposal {
	return {
		id: 'proposal-test',
		title: 'Organize source',
		sourcePath: 'Inbox/source.md',
		createdAt: '2026-06-23T00:00:00.000Z',
		status: 'pending',
		reason: 'Integration test proposal.',
		rationale: ['Verify selected writes, backups, and rollback.'],
		operations: [
			{
				id: 'update-source',
				type: 'update',
				path: 'Inbox/source.md',
				summary: 'Update source',
				selected: true,
				before: '# Source\n\nOriginal content.',
				after: '# Source\n\nUpdated content.',
			},
			{
				id: 'create-new',
				type: 'create',
				path: 'AI Notes/new-topic.md',
				summary: 'Create extracted note',
				selected: true,
				after: '# New Topic\n\nExtracted note.',
			},
			{
				id: 'ignored-update',
				type: 'update',
				path: 'Inbox/ignored.md',
				summary: 'Ignored update',
				selected: false,
				before: '# Ignored',
				after: '# Ignored\n\nShould not be written.',
			},
		],
	};
}
