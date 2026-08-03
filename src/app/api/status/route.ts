import { NextResponse } from 'next/server';
import { resolveProvider } from '@/lib/ai/client';

export const runtime = 'nodejs';

/** 헤더에 현재 생성 공급자를 표시하기 위한 엔드포인트. 키는 내려보내지 않는다. */
export async function GET() {
  const provider = resolveProvider();
  return NextResponse.json({
    mode: provider.id === 'local' ? 'local' : 'ai',
    provider: provider.id,
    label: provider.label,
    model: provider.model || null,
  });
}
