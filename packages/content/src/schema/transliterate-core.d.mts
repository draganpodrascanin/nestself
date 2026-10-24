/** Transliterate a single string from Serbian Latin to Cyrillic. */
export function transliterate(input: string): string;

/** Deep-transliterate all string values in a JSON-like object. */
export function transliterateObject<T>(obj: T): T;
