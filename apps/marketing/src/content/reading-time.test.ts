import { describe, it, expect } from 'vitest';
import { readingMinutes } from './reading-time';

describe('readingMinutes', () => {
  it('returns Math.max(1, Math.round(words / 200))', () => {
    // 200 words -> 1 minute
    const twoHundredWords = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    expect(readingMinutes(twoHundredWords)).toBe(1);

    // 400 words -> 2 minutes
    const fourHundredWords = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    expect(readingMinutes(fourHundredWords)).toBe(2);

    // 100 words -> Math.round(100/200) = 1, but max(1, 1) = 1
    const hundredWords = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
    expect(readingMinutes(hundredWords)).toBe(1);

    // 10 words -> Math.round(10/200) = 0, but max(1, 0) = 1
    expect(readingMinutes('one two three four five six seven eight nine ten')).toBe(1);
  });

  it('returns at least 1 for empty text', () => {
    expect(readingMinutes('')).toBe(1);
    expect(readingMinutes('   ')).toBe(1);
  });

  it('strips code blocks from the count', () => {
    const body = `Hello world\n\n\`\`\`ts\n${Array.from({ length: 600 }, (_, i) => `x${i}`).join(' ')}\n\`\`\`\n\nEnd`;
    // Only "Hello world End" => 3 words => max(1, round(3/200)) = 1
    expect(readingMinutes(body)).toBe(1);
  });

  it('strips inline code from the count', () => {
    const body = 'Use the `longVariableNameThatShouldNotCount` command to do things.';
    // "Use the command to do things." => 6 words
    expect(readingMinutes(body)).toBe(1);
  });

  it('strips HTML/JSX tags', () => {
    const body = '<Callout kind="tip">This is a tip about something useful.</Callout>';
    // "This is a tip about something useful." => 7 words
    expect(readingMinutes(body)).toBe(1);
  });
});
