/**
 * 스티치에서 고를 수 있는 모델 목록.
 *
 * 목록을 코드에 박아 두면 저쪽이 새 모델을 내놔도 사용자는 한참 못 쓴다.
 * 그래서 스티치에 직접 물어본다. 자격증명이 필요 없는 조회라 로그인만 본다.
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { listModels } from '@/lib/design/stitch';

export const runtime = 'nodejs';

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response;
  return NextResponse.json({ models: await listModels() });
}
