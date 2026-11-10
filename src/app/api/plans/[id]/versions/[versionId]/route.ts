import { NextResponse } from 'next/server';
import { requirePlanActor } from '@/lib/auth/plan-actor';
import { deletePlanVersion, getPlanVersion, savePlanVersion, VersionSnapshotConflictError } from '@/lib/db/plans';
import { serverErrorMessage } from '@/lib/api-error';
import type { PlanVersion } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; versionId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id, versionId } = await params;
  const { user, response } = await requirePlanActor(request, id);
  if (!user) return response;
  try {
    const version = await getPlanVersion(user.id, id, versionId);
    return version ? NextResponse.json({ version }) : NextResponse.json({ error: '버전을 찾을 수 없습니다.' }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: serverErrorMessage('plan-version', error) }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: Context) {
  const { id, versionId } = await params;
  const { user, response } = await requirePlanActor(request, id);
  if (!user) return response;
  let version: PlanVersion | undefined;
  try { version = (await request.json() as { version?: PlanVersion }).version; }
  catch { return NextResponse.json({ error: '버전 정보를 읽지 못했습니다.' }, { status: 400 }); }
  if (!version || version.id !== versionId || versionId.length > 128 ||
      !version.snapshot || typeof version.snapshot !== 'object' || Array.isArray(version.snapshot)) {
    return NextResponse.json({ error: '주소와 버전 ID·스냅샷이 일치해야 합니다.' }, { status: 400 });
  }
  try {
    const saved = await savePlanVersion(user.id, id, version);
    return saved ? NextResponse.json({ saved: true }) : NextResponse.json({ error: '플랜 또는 버전을 찾을 수 없습니다.' }, { status: 404 });
  } catch (error) {
    if (error instanceof VersionSnapshotConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: serverErrorMessage('plan-version', error) }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const { id, versionId } = await params;
  const { user, response } = await requirePlanActor(request, id);
  if (!user) return response;
  try {
    return NextResponse.json({ deleted: await deletePlanVersion(user.id, id, versionId) });
  } catch (error) {
    return NextResponse.json({ error: serverErrorMessage('plan-version', error) }, { status: 500 });
  }
}
