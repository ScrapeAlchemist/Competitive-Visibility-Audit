import { NextRequest, NextResponse } from 'next/server';
import { getAudit } from '@/lib/audit/state';

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const audit = getAudit(id);
  if (!audit) return NextResponse.json({ error: 'Audit not found' }, { status: 404 });
  return NextResponse.json({ audit });
}
