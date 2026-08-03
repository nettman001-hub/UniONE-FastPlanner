/**
 * 생성 작업 저장소.
 *
 * 작업은 서버에서 돌고 결과는 여기에 쌓인다. 브라우저는 결과를 **가지러 오는** 쪽이라,
 * 탭을 닫거나 새로고침해도 작업은 끝까지 진행되고 나중에 받아 갈 수 있다.
 *
 * 저장소를 갈아 끼울 수 있게 인터페이스로 두었다. 배포 형태마다 필요한 내구성이 다르다.
 *
 * | 저장소 | 조건 | 내구성 |
 * | --- | --- | --- |
 * | 메모리 (기본) | 없음 | 서버 프로세스가 사는 동안. 재시작하면 사라진다 |
 * | 파일 | `JOB_STORE_DIR` | 서버를 재시작해도 남는다 |
 *
 * **서버리스(Vercel) 주의** — 인스턴스가 여러 개로 흩어지고 `/tmp` 도 공유되지 않으므로
 * 두 저장소 모두 인스턴스 간에는 보장되지 않는다. 그 환경에서 완전한 내구성이 필요하면
 * 이 인터페이스를 구현한 외부 저장소(KV·Redis·DB) 어댑터를 붙이면 된다.
 */

import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArtifactKey, PlanDocuments } from '../types';
import type { JobStatus } from './progress';

export type { JobStatus };

export interface Job {
  id: string;
  planId: string;
  /** 이 작업이 만들 산출물. 전체 자동 생성이면 5개가 순서대로 들어간다. */
  artifacts: ArtifactKey[];
  status: JobStatus;
  /** 지금 만들고 있는 산출물 */
  current: ArtifactKey | null;
  /** 완료된 산출물 */
  done: ArtifactKey[];
  /** 지금까지 만들어진 문서 (누적) */
  patch: Partial<PlanDocuments>;
  /** AI 호출이 실패해 내장 생성기로 넘어간 단계의 사유 */
  warnings: string[];
  /** 마지막 단계를 무엇으로 만들었는지 */
  source: 'ai' | 'local' | null;
  error?: string;
  /** 이 작업에 쓴 크레딧. 새로 연 브라우저가 실패분을 돌려받을 수 있게 함께 보관한다. */
  cost: number;
  createdAt: number;
  updatedAt: number;
}

export interface JobStore {
  create(job: Job): Promise<void>;
  update(id: string, patch: Partial<Job>): Promise<Job | undefined>;
  get(id: string): Promise<Job | undefined>;
  /** 그 플랜의 작업을 최신순으로 */
  listByPlan(planId: string): Promise<Job[]>;
}

/** 끝난 작업을 얼마나 남겨 둘지. 돌아온 사용자가 결과를 받아 갈 시간을 준다. */
const RETENTION_MS = 30 * 60 * 1000;
/** 진행 중인 채로 이만큼 지나면 죽은 작업으로 본다 (서버 강제 종료 등). */
const STALE_MS = 20 * 60 * 1000;

export function isFinished(job: Job) {
  return job.status === 'done' || job.status === 'error';
}

/** 응답이 끊긴 채 방치된 작업인지. 화면이 영원히 "생성 중" 으로 남지 않게 한다. */
export function isStale(job: Job) {
  return !isFinished(job) && Date.now() - job.updatedAt > STALE_MS;
}

function expired(job: Job) {
  return isFinished(job) && Date.now() - job.updatedAt > RETENTION_MS;
}

/* 메모리 저장소 ----------------------------------------------------- */

class MemoryJobStore implements JobStore {
  private jobs = new Map<string, Job>();

  private sweep() {
    for (const [id, job] of this.jobs) if (expired(job)) this.jobs.delete(id);
  }

  async create(job: Job) {
    this.sweep();
    this.jobs.set(job.id, job);
  }

  async update(id: string, patch: Partial<Job>) {
    const current = this.jobs.get(id);
    if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: Date.now() };
    this.jobs.set(id, next);
    return next;
  }

  async get(id: string) {
    return this.jobs.get(id);
  }

  async listByPlan(planId: string) {
    this.sweep();
    return [...this.jobs.values()]
      .filter((job) => job.planId === planId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}

/* 파일 저장소 ------------------------------------------------------- */

class FileJobStore implements JobStore {
  constructor(private dir: string) {}

  private file(id: string) {
    // id 는 서버가 만든 값이지만, 경로 조작을 원천적으로 막기 위해 파일명만 쓴다.
    return path.join(this.dir, `${path.basename(id)}.json`);
  }

  private async ready() {
    await mkdir(this.dir, { recursive: true });
  }

  private async read(id: string): Promise<Job | undefined> {
    try {
      return JSON.parse(await readFile(this.file(id), 'utf8')) as Job;
    } catch {
      return undefined;
    }
  }

  async create(job: Job) {
    await this.ready();
    await writeFile(this.file(job.id), JSON.stringify(job), 'utf8');
    void this.sweep();
  }

  async update(id: string, patch: Partial<Job>) {
    const current = await this.read(id);
    if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: Date.now() };
    await writeFile(this.file(id), JSON.stringify(next), 'utf8');
    return next;
  }

  async get(id: string) {
    return this.read(id);
  }

  async listByPlan(planId: string) {
    await this.ready();
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const jobs: Job[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const job = await this.read(name.slice(0, -5));
      if (job?.planId === planId) jobs.push(job);
    }
    return jobs.sort((a, b) => b.createdAt - a.createdAt);
  }

  private async sweep() {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const job = await this.read(name.slice(0, -5));
      if (job && expired(job)) await unlink(this.file(job.id)).catch(() => {});
    }
  }
}

/* 선택 --------------------------------------------------------------- */

/**
 * 개발 중 핫 리로드로 모듈이 다시 평가되면 저장소가 새로 만들어져 진행 중인 작업을
 * 잃는다. 전역에 붙여 한 번만 만든다.
 */
const globalRef = globalThis as typeof globalThis & { __planJobStore?: JobStore };

export function jobStore(): JobStore {
  if (!globalRef.__planJobStore) {
    const dir = process.env.JOB_STORE_DIR?.trim();
    globalRef.__planJobStore = dir ? new FileJobStore(dir) : new MemoryJobStore();
  }
  return globalRef.__planJobStore;
}
