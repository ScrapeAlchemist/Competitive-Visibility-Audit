import { NextRequest, NextResponse } from 'next/server';
import { ConfirmAuditRequest, DiscoveredBrand } from '@/lib/types';
import { getAudit, log } from '@/lib/audit/state';
import { startMainPipeline } from '@/lib/audit/pipeline';

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const audit = getAudit(id);
  if (!audit) return NextResponse.json({ error: 'Audit not found' }, { status: 404 });
  if (!audit.brand) {
    return NextResponse.json({ error: 'Brand discovery has not completed yet' }, { status: 409 });
  }
  if (audit.status !== 'awaiting_confirmation') {
    return NextResponse.json(
      { error: `Cannot confirm in status "${audit.status}"` },
      { status: 409 }
    );
  }

  let body: ConfirmAuditRequest = {};
  try {
    body = (await request.json()) as ConfirmAuditRequest;
  } catch {
    // empty body is fine - means accept the discovered URL
  }

  let confirmed: DiscoveredBrand = audit.brand;
  if (body.url && body.url !== audit.brand.url) {
    let domain = '';
    try {
      domain = new URL(body.url).hostname.replace(/^www\./, '');
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }
    confirmed = { ...audit.brand, url: body.url, domain };
    log(id, 'INFO', `User overrode discovered URL: ${body.url}`);
  } else {
    log(id, 'INFO', `User confirmed discovered URL: ${audit.brand.url}`);
  }

  startMainPipeline(id, confirmed);
  return NextResponse.json({ ok: true });
}
