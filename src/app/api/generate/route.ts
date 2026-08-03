import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { enqueue, precondition } from '@/lib/jobs/queue';
import { ARTIFACT_CREDIT_COST, type ArtifactKey, type Plan } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const VALID: ArtifactKey[] = ['prd', 'fs', 'ia', 'flow', 'wireframe'];

interface GenerateBody {
  /** 한 종만 만들 때 */
  artifact?: ArtifactKey;
  /** 순서대로 이어서 만들 때 (전체 자동 생성) */
  artifacts?: ArtifactKey[];
  plan: Plan;
  /** 사용자가 추가로 준 지시 */
  extra?: string;
  /** 와이어프레임을 만들 대상 페이지 */
  pageIds?: string[];
  /** 기존 와이어프레임을 유지하고 병합할지 */
  merge?: boolean;
}

/**
 * 생성 작업을 맡긴다.
 *
 * 결과를 기다리지 않고 작업 번호만 돌려준다. 브라우저는 `/api/jobs/{id}` 로
 * 받아 가며, 탭을 닫아도 서버는 끝까지 만든다.
 */
export async function POST(request: Request) {
  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다.' }, { status: 400 });
  }

  const { plan } = body;
  const artifacts = body.artifacts ?? (body.artifact ? [body.artifact] : []);

  if (artifacts.length === 0 || artifacts.some((a) => !VALID.includes(a))) {
    return NextResponse.json({ error: '지원하지 않는 산출물입니다.' }, { status: 400 });
  }
  if (!plan?.id) {
    return NextResponse.json({ error: '플랜 정보가 없습니다.' }, { status: 400 });
  }

  // 첫 단계는 지금 바로 판단할 수 있다. 뒤 단계는 앞 결과에 달렸으므로 작업 안에서 본다.
  const blocked = precondition(plan, artifacts[0]);
  if (blocked) {
    const status = plan.brief?.idea?.trim() ? 409 : 400;
    return NextResponse.json({ error: blocked }, { status });
  }

  const cost = artifacts.reduce((sum, a) => sum + ARTIFACT_CREDIT_COST[a], 0);
  const { job, running } = await enqueue(plan.id, plan, artifacts, cost, {
    extra: body.extra,
    pageIds: body.pageIds,
    merge: body.merge,
  });

  /*
   * 응답을 보낸 뒤에도 실행이 살아 있어야 한다.
   * 서버리스에서는 응답과 함께 인스턴스가 얼어붙을 수 있어 after() 로 붙잡아 둔다.
   * 일반 Node 서버에서는 없어도 돌지만, 두 환경에서 같게 동작하도록 항상 건다.
   */
  after(async () => {
    await running;
  });

  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
}
