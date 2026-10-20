export function isSampleMode(env: Record<string, string | undefined>): boolean {
  return (
    env.VITE_DATA_SOURCE === 'sample' ||
    env.EXPO_PUBLIC_DATA_SOURCE === 'sample'
  );
}

export function assertNotProduction(
  env: Record<string, string | undefined>,
): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Sample data must not be used in production');
  }
}
