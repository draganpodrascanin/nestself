import type { ReactNode } from 'react';

export interface ConfirmLabelProps {
  action: string;
  amount: string;
}

export function ConfirmLabel({ action, amount }: ConfirmLabelProps): ReactNode {
  return (
    <span>
      {action} {amount}
    </span>
  );
}
