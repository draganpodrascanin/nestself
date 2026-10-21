import { NextResponse } from 'next/server';
import { DemoRequestSchema, ContactMessageSchema, WebinarRegistrationSchema } from '@nestself/contracts';

const schemas: Record<string, typeof DemoRequestSchema | typeof ContactMessageSchema | typeof WebinarRegistrationSchema> = {
  'demo-requests': DemoRequestSchema,
  'contact': ContactMessageSchema,
  'webinar-registrations': WebinarRegistrationSchema,
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  const schema = schemas[kind];
  if (!schema) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', issues: [{ path: [], message: 'Invalid JSON body' }] },
      { status: 400 },
    );
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((iss) => ({
      path: iss.path ?? [],
      message: iss.message,
    }));
    return NextResponse.json({ error: 'validation', issues }, { status: 400 });
  }

  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  try {
    const upstream = await fetch(`${apiUrl}/api/leads/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result.data),
      signal: AbortSignal.timeout(10_000),
    });

    const upstreamBody = await upstream.text();
    return new NextResponse(upstreamBody, {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return NextResponse.json({ error: 'upstream_timeout' }, { status: 504 });
  }
}
