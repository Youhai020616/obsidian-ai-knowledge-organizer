export type DiffLineType = 'same' | 'add' | 'remove';

export interface DiffLine {
	type: DiffLineType;
	text: string;
	oldLine?: number;
	newLine?: number;
}

export interface DiffSummary {
	added: number;
	removed: number;
	unchanged: number;
}

export function buildLineDiff(before: string, after: string): DiffLine[] {
	const beforeLines = before.split('\n');
	const afterLines = after.split('\n');
	const lcs = buildLcsTable(beforeLines, afterLines);
	const result: DiffLine[] = [];
	let i = 0;
	let j = 0;
	let oldLine = 1;
	let newLine = 1;

	while (i < beforeLines.length || j < afterLines.length) {
		if (
			i < beforeLines.length &&
			j < afterLines.length &&
			beforeLines[i] === afterLines[j]
		) {
			result.push({
				type: 'same',
				text: beforeLines[i] ?? '',
				oldLine,
				newLine,
			});
			i += 1;
			j += 1;
			oldLine += 1;
			newLine += 1;
			continue;
		}

		if (
			j < afterLines.length &&
			(i >= beforeLines.length ||
				(lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))
		) {
			result.push({
				type: 'add',
				text: afterLines[j] ?? '',
				newLine,
			});
			j += 1;
			newLine += 1;
			continue;
		}

		if (i < beforeLines.length) {
			result.push({
				type: 'remove',
				text: beforeLines[i] ?? '',
				oldLine,
			});
			i += 1;
			oldLine += 1;
		}
	}

	return result;
}

export function summarizeDiff(lines: DiffLine[]): DiffSummary {
	return lines.reduce(
		(summary, line) => {
			if (line.type === 'add') {
				summary.added += 1;
			} else if (line.type === 'remove') {
				summary.removed += 1;
			} else {
				summary.unchanged += 1;
			}
			return summary;
		},
		{ added: 0, removed: 0, unchanged: 0 },
	);
}

export function compactDiff(lines: DiffLine[], contextLines = 3): DiffLine[] {
	const changedIndexes = new Set<number>();
	lines.forEach((line, index) => {
		if (line.type !== 'same') {
			for (
				let cursor = Math.max(0, index - contextLines);
				cursor <= Math.min(lines.length - 1, index + contextLines);
				cursor += 1
			) {
				changedIndexes.add(cursor);
			}
		}
	});

	if (changedIndexes.size === 0) {
		return lines.slice(0, Math.min(lines.length, 12));
	}

	const result: DiffLine[] = [];
	let skipped = false;
	lines.forEach((line, index) => {
		if (changedIndexes.has(index)) {
			if (skipped) {
				result.push({ type: 'same', text: '...' });
				skipped = false;
			}
			result.push(line);
		} else {
			skipped = true;
		}
	});
	return result;
}

function buildLcsTable(before: string[], after: string[]): number[][] {
	const table: number[][] = Array.from({ length: before.length + 1 }, () =>
		Array.from({ length: after.length + 1 }, () => 0),
	);

	for (let i = before.length - 1; i >= 0; i -= 1) {
		for (let j = after.length - 1; j >= 0; j -= 1) {
			table[i]![j] =
				before[i] === after[j]
					? (table[i + 1]?.[j + 1] ?? 0) + 1
					: Math.max(table[i + 1]?.[j] ?? 0, table[i]?.[j + 1] ?? 0);
		}
	}

	return table;
}
