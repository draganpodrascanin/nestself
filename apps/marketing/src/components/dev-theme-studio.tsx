'use client';

import { ThemeStudio } from '@nestself/ui';

export function DevThemeStudio() {
  return <ThemeStudio enabled={process.env.NODE_ENV !== 'production'} />;
}
