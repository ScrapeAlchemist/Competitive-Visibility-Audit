import { NextResponse } from 'next/server';
import { warmup as bdWarmup } from '@/lib/brightdata';
import { warmup as claudeWarmup } from '@/lib/claude-cli';
import { isEmailConfigured } from '@/lib/email';

export async function GET() {
  const [bd, claude] = await Promise.all([bdWarmup(), claudeWarmup()]);
  return NextResponse.json({
    bd: { serp: bd.serp, unlocker: bd.unlocker },
    claude,
    email: isEmailConfigured(),
  });
}
