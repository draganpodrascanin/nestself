import { describe, it, expect } from 'vitest';
import { typeStyle, resolveTone, fontFamilyForWeight } from './typography';
import type { NativeColors } from '@nestself/tokens/native';

describe('typeStyle', () => {
  it('returns correct style for body on ios', () => {
    const result = typeStyle('body', 'ios');
    expect(result.fontSize).toBe(17);
    expect(result.lineHeight).toBe(25);
    expect(result.fontWeight).toBe('400');
    expect(result.fontFamily).toBe('Onest-Regular');
  });

  it('returns correct style for label on android', () => {
    const result = typeStyle('label', 'android');
    expect(result.fontFamily).toBe('Onest-SemiBold');
    expect(result.fontWeight).toBe('600');
  });

  it('returns correct style for display (bold weight)', () => {
    const result = typeStyle('display', 'ios');
    expect(result.fontSize).toBe(40);
    expect(result.lineHeight).toBe(48);
    expect(result.fontWeight).toBe('600');
    expect(result.fontFamily).toBe('Onest-SemiBold');
  });

  it('returns correct style for metadata on android', () => {
    const result = typeStyle('metadata', 'android');
    expect(result.fontSize).toBe(14);
    expect(result.lineHeight).toBe(20);
    expect(result.fontWeight).toBe('400');
    expect(result.fontFamily).toBe('Onest-Regular');
  });
});

describe('fontFamilyForWeight', () => {
  it('maps 400 to Onest-Regular', () => {
    expect(fontFamilyForWeight('400')).toBe('Onest-Regular');
  });

  it('maps 600 to Onest-SemiBold', () => {
    expect(fontFamilyForWeight('600')).toBe('Onest-SemiBold');
  });

  it('maps 700 to Onest-Bold', () => {
    expect(fontFamilyForWeight('700')).toBe('Onest-Bold');
  });
});

describe('resolveTone', () => {
  const colors: NativeColors = {
    canvas: '#F4F9F7',
    surface: '#FFFFFF',
    raised: '#FFFFFF',
    tint: '#E8F0EC',
    text: '#25352D',
    textSecondary: '#5A6B62',
    borderSubtle: '#D5DDD9',
    borderControl: '#A8B5AE',
    primary: '#31594D',
    primaryHover: '#2A4C42',
    primaryPressed: '#234038',
    onPrimary: '#FFFFFF',
    accent: '#BFDED3',
    onAccent: '#25352D',
    accentSoft: '#E8F0EC',
    focus: '#31594D',
    disabledSurface: '#E8EBE9',
    disabledText: '#A8B5AE',
    scrim: 'rgba(0,0,0,0.4)',
    success: '#2E7D4F',
    successSurface: '#E8F5E9',
    warning: '#E67E22',
    warningSurface: '#FFF3E0',
    danger: '#D32F2F',
    dangerSurface: '#FFEBEE',
    info: '#1976D2',
    infoSurface: '#E3F2FD',
  };

  it('resolves default tone to text color', () => {
    expect(resolveTone(colors, 'default')).toBe(colors.text);
  });

  it('resolves secondary tone to textSecondary color', () => {
    expect(resolveTone(colors, 'secondary')).toBe(colors.textSecondary);
  });

  it('resolves danger tone to danger color', () => {
    expect(resolveTone(colors, 'danger')).toBe(colors.danger);
  });

  it('resolves onPrimary tone to onPrimary color', () => {
    expect(resolveTone(colors, 'onPrimary')).toBe(colors.onPrimary);
  });
});
