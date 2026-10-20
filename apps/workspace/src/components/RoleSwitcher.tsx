/**
 * RoleSwitcher — development-only sample role switcher.
 * Rendered inside the ThemeStudio panel.
 */
import { orgRoles } from '@nestself/contracts';
import type { OrgRole } from '@nestself/contracts';
import { useSession } from '../session';

export function RoleSwitcher() {
  const { session, setRole } = useSession();

  return (
    <label className="flex flex-col gap-1 type-metadata">
      Sample role
      <select
        value={session.orgRole ?? 'employee'}
        onChange={(e) => setRole(e.target.value as OrgRole)}
        className="rounded-control border border-border-control bg-surface px-2 py-1"
      >
        {orgRoles.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
    </label>
  );
}
