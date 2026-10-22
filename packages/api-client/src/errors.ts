export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | undefined;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    requestId: string | null;
    details?: Record<string, unknown>;
  }) {
    super(opts.message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
    this.details = opts.details;
  }
}
