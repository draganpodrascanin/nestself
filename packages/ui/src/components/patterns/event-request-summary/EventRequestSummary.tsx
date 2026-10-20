import { cn } from '../../../lib/cn';

export interface EventRequest {
  participants: string;
  location: string;
  dates: string;
  budget: string;
  options: string[];
  workflow: string[];
}

export interface EventRequestSummaryLabels {
  title?: string;
  field: string;
  example: string;
  required: string;
  participants: string;
  location: string;
  dates: string;
  budget: string;
  /** Translated "Yes" value for the Required column. */
  yes: string;
  /** Translated "No" value for the Required column. */
  no: string;
}

export interface EventRequestSummaryProps {
  request: EventRequest;
  labels: EventRequestSummaryLabels;
  className?: string;
}

export function EventRequestSummary({ request, labels, className }: EventRequestSummaryProps) {
  const rows = [
    { field: labels.participants, example: request.participants, required: labels.yes },
    { field: labels.location, example: request.location, required: labels.yes },
    { field: labels.dates, example: request.dates, required: labels.yes },
    { field: labels.budget, example: request.budget, required: labels.no },
  ];

  return (
    <div className={cn('overflow-x-auto border border-border-subtle rounded-card bg-surface mt-6', className)}>
      <table className="w-full border-collapse text-left min-w-[42rem] type-table">
        <thead>
          <tr>
            <th className="h-14 px-4 py-3 bg-tint font-[var(--font-weight-label)] border-b border-border-subtle">
              {labels.field}
            </th>
            <th className="h-14 px-4 py-3 bg-tint font-[var(--font-weight-label)] border-b border-border-subtle">
              {labels.example}
            </th>
            <th className="h-14 px-4 py-3 bg-tint font-[var(--font-weight-label)] border-b border-border-subtle">
              {labels.required}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.field}>
              <td
                className={cn(
                  'h-14 px-4 py-3 align-top',
                  index < rows.length - 1 && 'border-b border-border-subtle',
                )}
              >
                {row.field}
              </td>
              <td
                className={cn(
                  'h-14 px-4 py-3 align-top',
                  index < rows.length - 1 && 'border-b border-border-subtle',
                )}
              >
                {row.example}
              </td>
              <td
                className={cn(
                  'h-14 px-4 py-3 align-top',
                  index < rows.length - 1 && 'border-b border-border-subtle',
                )}
              >
                {row.required}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
