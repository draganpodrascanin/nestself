import { cn } from '../../../lib/cn';
import { Table, Th, Td } from '../../tables/table';

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
    <Table className={cn('mt-6', className)}>
      <thead>
        <tr>
          <Th className="bg-tint border-b border-border-subtle">{labels.field}</Th>
          <Th className="bg-tint border-b border-border-subtle">{labels.example}</Th>
          <Th className="bg-tint border-b border-border-subtle">{labels.required}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.field}>
            <Td
              className={cn(
                'align-top',
                index < rows.length - 1 && 'border-b border-border-subtle',
              )}
            >
              {row.field}
            </Td>
            <Td
              className={cn(
                'align-top',
                index < rows.length - 1 && 'border-b border-border-subtle',
              )}
            >
              {row.example}
            </Td>
            <Td
              className={cn(
                'align-top',
                index < rows.length - 1 && 'border-b border-border-subtle',
              )}
            >
              {row.required}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
