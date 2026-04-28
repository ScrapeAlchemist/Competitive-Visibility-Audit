import { NextRequest, NextResponse } from 'next/server';
import { StartAuditRequest, StartAuditResponse } from '@/lib/types';
import { createAudit } from '@/lib/audit/state';
import { startDiscovery } from '@/lib/audit/pipeline';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as StartAuditRequest;
    const brandName = (body.brandName || '').trim();
    const location = (body.location || '').trim();
    const recipientEmail = body.recipientEmail?.trim();

    if (!brandName) {
      return NextResponse.json({ error: 'brandName is required' }, { status: 400 });
    }
    if (!location) {
      return NextResponse.json({ error: 'location is required' }, { status: 400 });
    }

    const auditId = createAudit({ brandName, location, recipientEmail });
    startDiscovery(auditId);

    const response: StartAuditResponse = { auditId };
    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start audit' },
      { status: 500 }
    );
  }
}
