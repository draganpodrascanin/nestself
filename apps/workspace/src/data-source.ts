/**
 * Data source mode resolution (orchestrator ruling #1).
 *
 * `VITE_DATA_SOURCE` explicit `'sample'` or `'api'` wins.
 * When absent: dev builds default to `'sample'`, production to `'api'`.
 */
export type DataSource = 'sample' | 'api';

export function resolveDataSource(): DataSource {
  const explicit = import.meta.env.VITE_DATA_SOURCE;
  if (explicit === 'sample' || explicit === 'api') return explicit;
  return import.meta.env.DEV ? 'sample' : 'api';
}

export const dataSource: DataSource = resolveDataSource();

/** True when the app should show sample data and the dev role switcher. */
export const isSampleDataMode = dataSource === 'sample';
