import { NextResponse } from 'next/server';
import { hasApiKey, MODEL } from '@/lib/ai/client';

export const runtime = 'nodejs';

/** 헤더에 AI 연결 상태를 표시하기 위한 엔드포인트. */
export async function GET() {
  return NextResponse.json({
    mode: hasApiKey() ? 'ai' : 'local',
    model: hasApiKey() ? MODEL : null,
  });
}
