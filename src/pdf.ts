export function extractPdfText(buffer: ArrayBuffer): string {
	const source = new TextDecoder('latin1').decode(buffer);
	const segments = [
		...extractLiteralTextOperators(source),
		...extractHexTextOperators(source),
		...extractTextArrays(source),
	];
	return normalizeExtractedText(segments.join(' '));
}

function extractLiteralTextOperators(source: string): string[] {
	return Array.from(
		source.matchAll(/(\((?:\\.|[^\\()])*\))\s*(?:Tj|'|")/gu),
		(match) => decodePdfLiteral(match[1] ?? ''),
	);
}

function extractHexTextOperators(source: string): string[] {
	return Array.from(
		source.matchAll(/(?<!<)<([0-9a-fA-F\s]+)>(?!>)\s*Tj/gu),
		(match) => decodePdfHex(match[1] ?? ''),
	);
}

function extractTextArrays(source: string): string[] {
	return Array.from(source.matchAll(/\[([\s\S]*?)\]\s*TJ/gu), (match) => {
		const arrayBody = match[1] ?? '';
		return Array.from(
			arrayBody.matchAll(/(\((?:\\.|[^\\()])*\)|(?<!<)<[0-9a-fA-F\s]+>(?!>))/gu),
			(tokenMatch) => decodePdfTextToken(tokenMatch[1] ?? ''),
		).join(' ');
	});
}

function decodePdfTextToken(token: string): string {
	if (token.startsWith('(')) {
		return decodePdfLiteral(token);
	}
	return decodePdfHex(token.slice(1, -1));
}

function decodePdfLiteral(token: string): string {
	const value = token.startsWith('(') && token.endsWith(')')
		? token.slice(1, -1)
		: token;
	let output = '';
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (char !== '\\') {
			output += char;
			continue;
		}
		const next = value[index + 1];
		if (!next) {
			continue;
		}
		if (/[0-7]/u.test(next)) {
			const octal = value.slice(index + 1).match(/^[0-7]{1,3}/u)?.[0] ?? next;
			output += String.fromCharCode(Number.parseInt(octal, 8));
			index += octal.length;
			continue;
		}
		index += 1;
		if (next === 'n') {
			output += '\n';
		} else if (next === 'r') {
			output += '\r';
		} else if (next === 't') {
			output += '\t';
		} else if (next === 'b') {
			output += '\b';
		} else if (next === 'f') {
			output += '\f';
		} else if (next === '\n' || next === '\r') {
			if (next === '\r' && value[index + 1] === '\n') {
				index += 1;
			}
		} else {
			output += next;
		}
	}
	return output;
}

function decodePdfHex(hex: string): string {
	const normalized = hex.replace(/\s+/gu, '');
	const padded = normalized.length % 2 === 0 ? normalized : `${normalized}0`;
	const bytes: number[] = [];
	for (let index = 0; index < padded.length; index += 2) {
		bytes.push(Number.parseInt(padded.slice(index, index + 2), 16));
	}
	if (bytes[0] === 0xfe && bytes[1] === 0xff) {
		return decodeUtf16BigEndian(bytes.slice(2));
	}
	return String.fromCharCode(...bytes);
}

function decodeUtf16BigEndian(bytes: number[]): string {
	let output = '';
	for (let index = 0; index + 1 < bytes.length; index += 2) {
		const high = bytes[index] ?? 0;
		const low = bytes[index + 1] ?? 0;
		output += String.fromCharCode((high << 8) | low);
	}
	return output;
}

function normalizeExtractedText(value: string): string {
	return Array.from(value, normalizeControlCharacter)
		.join('')
		.replace(/[ \t]{2,}/gu, ' ')
		.replace(/\s+\n/gu, '\n')
		.replace(/\n\s+/gu, '\n')
		.replace(/\n{3,}/gu, '\n\n')
		.trim()
		.slice(0, 50000);
}

function normalizeControlCharacter(character: string): string {
	const code = character.charCodeAt(0);
	if ((code < 32 && character !== '\n' && character !== '\t') || code === 127) {
		return ' ';
	}
	return character;
}
