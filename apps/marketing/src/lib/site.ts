export const WORKSPACE_URL = process.env.NEXT_PUBLIC_WORKSPACE_URL ?? 'http://localhost:5173';
export const STORYBOOK_URL = process.env.NEXT_PUBLIC_STORYBOOK_URL ?? (process.env.NODE_ENV === 'development' ? 'http://localhost:6006' : '');
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
