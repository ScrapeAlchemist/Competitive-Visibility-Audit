import { NextRequest, NextResponse } from 'next/server';
import { EmailAuditRequest } from '@/lib/types';
import { getAudit, log } from '@/lib/audit/state';
import { sendReport, isEmailConfigured } from '@/lib/email';
import { renderReportEmailHtml, renderReportEmailText } from '@/lib/report-html';

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const audit = getAudit(id);
  if (!audit) return NextResponse.json({ error: 'Audit not found' }, { status: 404 });
  if (!audit.report) {
    return NextResponse.json(
      { error: 'Report not ready - audit still in progress' },
      { status: 409 }
    );
  }
  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: 'SMTP not configured. Add SMTP_HOST/PORT/USER/PASS/FROM to .env.local' },
      { status: 503 }
    );
  }

  let body: EmailAuditRequest;
  try {
    body = (await request.json()) as EmailAuditRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const recipient = body.recipientEmail?.trim();
  if (!recipient) {
    return NextResponse.json({ error: 'recipientEmail is required' }, { status: 400 });
  }

  try {
    const subject = `Competitive visibility audit: ${audit.report.brand.domain}`;
    const html = renderReportEmailHtml(audit.report);
    const text = renderReportEmailText(audit.report);
    await sendReport({ to: recipient, subject, html, text });
    log(id, 'INFO', `Report emailed to ${recipient}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to send email' },
      { status: 500 }
    );
  }
}
