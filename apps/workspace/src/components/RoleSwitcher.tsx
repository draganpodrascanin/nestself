/**
 * RoleSwitcher -- development-only sample role switcher.
 * Rendered inside the ThemeStudio panel when `isSampleDataMode` is true.
 */
import { SAMPLE_ROLE_ORDER, useSampleAuth } from '../auth';

export function RoleSwitcher() {
  const { currentRole, setRole } = useSampleAuth();

  return (
    <label className="flex flex-col gap-1 type-metadata">
      Sample role
      <select
        value={currentRole}
        onChange={(e) => setRole(e.target.value)}
        className="rounded-control border border-border-control bg-surface px-2 py-1"
      >
        {SAMPLE_ROLE_ORDER.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
    </label>
  );
}
