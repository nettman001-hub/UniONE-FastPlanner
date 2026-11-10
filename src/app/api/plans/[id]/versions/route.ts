import { NextResponse } from 'next/server';
import { requirePlanActor } from '@/lib/auth/plan-actor';
import { listVersionSummaries, planExists, savePlanVersion, VersionSnapshotConflictError } from '@/lib/db/plans';
import { serverErrorMessage } from '@/lib/api-error';
import type { PlanVersion } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const { user, response } = await requirePlanActor(request, id);
  if (!user) return response;
  try {
    if (!(await planExists(user.id, id))) return NextResponse.json({ error: '플랜을 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ versions: await listVersionSummaries(user.id, id) });
  } catch (error) {
    return NextResponse.json({ error: serverErrorMessage('plan-versions', error) }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const { user, response } = await requirePlanActor(request, id);
  if (!user) return response;
  let version: PlanVersion | undefined;
  try { version = (await request.json() as { version?: PlanVersion }).version; }
  catch { return NextResponse.json({ error: '버전 정보를 읽지 못했습니다.' }, { status: 400 }); }
  if (!version || typeof version.id !== 'string' || !version.id || version.id.length > 128 ||
      !version.snapshot || typeof version.snapshot !== 'object' || Array.isArray(version.snapshot)) {
    return NextResponse.json({ error: '버전 ID와 스냅샷이 필요합니다.' }, { status: 400 });
  }
  try {
    const saved = await savePlanVersion(user.id, id, version);
    return saved ? NextResponse.json({ saved: true }) : NextResponse.json({ error: '플랜 또는 버전을 찾을 수 없습니다.' }, { status: 404 });
  } catch (error) {
    if (error instanceof VersionSnapshotConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: serverErrorMessage('plan-versions', error) }, { status: 500 });
  }
}
