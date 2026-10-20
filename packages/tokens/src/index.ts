import tokensJson from '../tokens.json';

export const tokens = tokensJson;
export const palettes = ['forest', 'ink', 'plum', 'azure'] as const;
export const modes = ['light', 'dark'] as const;
export const fonts = ['onest', 'commissioner', 'nunito', 'fira', 'lato'] as const;
export type Palette = (typeof palettes)[number];
export type Mode = (typeof modes)[number];
export type FontId = (typeof fonts)[number];
export type ThemeSelection = { palette: Palette; mode: Mode; font: FontId };
export const DEFAULT_THEME: ThemeSelection = { palette: 'forest', mode: 'light', font: 'onest' };

export type ThemeColors = (typeof tokensJson)['themes']['forest']['light'];
export type SemanticColor = keyof ThemeColors;
export const themes = tokensJson.themes;
export const themeMeta = Object.fromEntries(
  palettes.map((p) => [p, { name: tokensJson.themes[p].name, subtitle: tokensJson.themes[p].subtitle, description: tokensJson.themes[p].description }]),
) as Record<Palette, { name: string; subtitle: string; description: string }>;

export const space = tokensJson.primitive.space;
export const radius = tokensJson.primitive.radius;
export const borderWidth = tokensJson.primitive.borderWidth;
export const shadow = tokensJson.primitive.shadow;
export const zIndex = tokensJson.primitive.zIndex;
export const motion = tokensJson.primitive.motion;
export const typography = tokensJson.typography;
export const layout = tokensJson.layout;
export const components = tokensJson.components;
export const iconMapping = tokensJson.iconMapping;
export type IconCategory = keyof typeof iconMapping;
export const requiredStates = tokensJson.requiredStates;
export const patterns = tokensJson.patterns;
export const semanticRoles = tokensJson.semanticRoles;
export const accessibility = tokensJson.accessibility;
export const photography = tokensJson.photography;

export function isPalette(v: unknown): v is Palette { return typeof v === 'string' && (palettes as readonly string[]).includes(v); }
export function isMode(v: unknown): v is Mode { return typeof v === 'string' && (modes as readonly string[]).includes(v); }
export function isFont(v: unknown): v is FontId { return typeof v === 'string' && (fonts as readonly string[]).includes(v); }
