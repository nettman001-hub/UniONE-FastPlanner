import { NextResponse } from 'next/server';
import { endSession } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function POST() {
  await endSession();
  return NextResponse.json({ ok: true });
}
