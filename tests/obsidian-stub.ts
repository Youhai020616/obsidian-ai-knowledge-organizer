export class TFile {
	constructor(public path: string) {}

	get basename(): string {
		const fileName = this.path.split('/').pop() ?? this.path;
		return fileName.replace(/\.[^.]+$/u, '');
	}

	get extension(): string {
		const fileName = this.path.split('/').pop() ?? this.path;
		const dot = fileName.lastIndexOf('.');
		return dot >= 0 ? fileName.slice(dot + 1) : '';
	}
}

export function normalizePath(path: string): string {
	return path
		.replace(/\\/gu, '/')
		.replace(/\/{2,}/gu, '/')
		.replace(/^\.\//u, '')
		.replace(/\/$/u, '');
}

export async function requestUrl(): Promise<never> {
	throw new Error('requestUrl is not available in unit tests.');
}
