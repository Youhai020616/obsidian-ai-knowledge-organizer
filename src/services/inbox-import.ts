import { Notice } from 'obsidian';
import type { OrganizerContext } from '../context';
import { importUrlAsMarkdown } from '../importer';
import { extractPdfText } from '../pdf';
import { nowIso } from '../utils';
import { ensureFolder, getExistingPaths } from '../vault';

export class InboxImportService {
	constructor(private readonly ctx: OrganizerContext) {}

	async importUrlToInbox(url: string): Promise<void> {
		try {
			const conversation = this.ctx.appendUserMessage(
				`Import URL: ${url}`,
			);
			new Notice('Importing URL...');
			const page = await importUrlAsMarkdown(url);
			await ensureFolder(this.ctx.app, this.ctx.settings.inboxFolder);
			const existingPaths = await getExistingPaths(this.ctx.app);
			const path = uniquePath(
				`${this.ctx.settings.inboxFolder}/${page.fileName}`,
				existingPaths,
			);
			await this.ctx.app.vault.create(path, page.content);
			this.ctx.appendAssistantMessageToConversation(conversation.id, {
				text: `Imported into ${path}. Run "Organize my inbox" to generate proposals.`,
			});
			this.ctx.addAudit({
				action: 'import',
				message: `Imported ${page.url} into ${path}.`,
				paths: [path],
			});
			await this.ctx.savePluginData();
			new Notice('URL imported to inbox.');
		} catch (error) {
			await this.ctx.captureError(error, 'URL import failed');
		}
	}

	async importFilesToInbox(files: FileList): Promise<void> {
		try {
			if (files.length === 0) {
				new Notice('Choose at least one file.');
				return;
			}
			const conversation = this.ctx.appendUserMessage(
				`Import ${files.length} file(s)`,
			);
			await ensureFolder(this.ctx.app, this.ctx.settings.inboxFolder);
			await ensureFolder(
				this.ctx.app,
				`${this.ctx.settings.inboxFolder}/attachments`,
			);
			const existingPaths = await getExistingPaths(this.ctx.app);
			const importedPaths: string[] = [];
			for (const file of Array.from(files)) {
				importedPaths.push(
					...(await this.importOneFile(file, existingPaths)),
				);
			}
			this.ctx.appendAssistantMessageToConversation(conversation.id, {
				text: `Imported ${importedPaths.length} item(s) into the inbox. Run "Organize my inbox" to generate proposals.`,
			});
			this.ctx.addAudit({
				action: 'import',
				message: `Imported ${files.length} file(s) into the inbox.`,
				paths: importedPaths,
			});
			await this.ctx.savePluginData();
			new Notice('Files imported to inbox.');
		} catch (error) {
			await this.ctx.captureError(error, 'File import failed');
		}
	}

	private async importOneFile(
		file: File,
		existingPaths: Set<string>,
	): Promise<string[]> {
		const safeName = file.name.replace(/[\\/:*?"<>|]/gu, '-');
		const lowerName = safeName.toLowerCase();
		if (lowerName.endsWith('.md') || lowerName.endsWith('.txt')) {
			const path = uniquePath(
				`${this.ctx.settings.inboxFolder}/${safeName}`,
				existingPaths,
			);
			await this.ctx.app.vault.create(path, await file.text());
			existingPaths.add(path);
			return [path];
		}

		const attachmentPath = uniquePath(
			`${this.ctx.settings.inboxFolder}/attachments/${safeName}`,
			existingPaths,
		);
		const fileBuffer = await file.arrayBuffer();
		await this.ctx.app.vault.createBinary(attachmentPath, fileBuffer);
		existingPaths.add(attachmentPath);
		const extractedPdfText = lowerName.endsWith('.pdf')
			? extractPdfText(fileBuffer)
			: '';

		const sourceName = safeName.replace(/\.[^.]+$/u, '');
		const notePath = uniquePath(
			`${this.ctx.settings.inboxFolder}/${sourceName}.md`,
			existingPaths,
		);
		const note = [
			'---',
			`imported: ${nowIso()}`,
			`attachment: ${JSON.stringify(attachmentPath)}`,
			'tags:',
			'  - file-import',
			lowerName.endsWith('.pdf')
				? '  - pdf-import'
				: '  - attachment-import',
			'---',
			'',
			`# ${sourceName}`,
			'',
			`Imported attachment: [[${attachmentPath.replace(/\.md$/u, '')}]]`,
			'',
			buildFileImportBody(lowerName, extractedPdfText),
			'',
		].join('\n');
		await this.ctx.app.vault.create(notePath, note);
		existingPaths.add(notePath);
		return [attachmentPath, notePath];
	}
}

function buildFileImportBody(
	lowerName: string,
	extractedPdfText: string,
): string {
	if (!lowerName.endsWith('.pdf')) {
		return 'Attachment imported for review and linking.';
	}
	if (!extractedPdfText) {
		return 'No selectable PDF text could be extracted. The original PDF is preserved as an attachment for review and linking.';
	}
	return ['## Extracted text', '', extractedPdfText].join('\n');
}

function uniquePath(path: string, existingPaths: Set<string>): string {
	if (!existingPaths.has(path)) {
		return path;
	}
	const dot = path.lastIndexOf('.');
	const base = dot >= 0 ? path.slice(0, dot) : path;
	const ext = dot >= 0 ? path.slice(dot) : '';
	let counter = 2;
	let candidate = `${base}-${counter}${ext}`;
	while (existingPaths.has(candidate)) {
		counter += 1;
		candidate = `${base}-${counter}${ext}`;
	}
	return candidate;
}
