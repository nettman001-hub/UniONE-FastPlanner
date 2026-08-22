/** 기획 산출물을 외부 도구로 가져갈 수 있는 형식으로 변환한다. */

import {
  ARTIFACT_LABEL,
  FLOW_NODE_TYPE_LABEL,
  IA_PAGE_TYPE_LABEL,
  PLATFORM_LABEL,
  PRIORITY_LABEL,
  WIREFRAME_BLOCK_LABEL,
  type ArtifactKey,
  type IaPage,
  type Plan,
} from './types';
import { hasArtifact } from './artifact-status';
import {
  normalizeUinAiScreens,
  UINAI_AGENT_PROMPT,
  uinAiSourceSignature,
} from './design/uinai';

/* ------------------------------------------------------------------ */
/* 공통                                                                 */
/* ------------------------------------------------------------------ */

export function pageTree(pages: IaPage[]): { page: IaPage; depth: number }[] {
  const byParent = new Map<string | null, IaPage[]>();
  for (const page of pages) {
    const list = byParent.get(page.parentId) ?? [];
    list.push(page);
    byParent.set(page.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);

  const out: { page: IaPage; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const page of byParent.get(parentId) ?? []) {
      out.push({ page, depth });
      walk(page.id, depth + 1);
    }
  };
  walk(null, 0);

  // 부모가 사라진 고아 페이지도 빠뜨리지 않는다.
  const seen = new Set(out.map((o) => o.page.id));
  for (const page of pages) {
    if (!seen.has(page.id)) out.push({ page, depth: 0 });
  }
  return out;
}

function bullet(items: string[], indent = ''): string {
  if (items.length === 0) return `${indent}- (없음)`;
  return items.map((i) => `${indent}- ${i}`).join('\n');
}

/* ------------------------------------------------------------------ */
/* 마크다운                                                             */
/* ------------------------------------------------------------------ */

export function toMarkdown(plan: Plan, artifacts?: ArtifactKey[]): string {
  const include = (key: ArtifactKey) => !artifacts || artifacts.includes(key);
  const out: string[] = [];
  const { brief } = plan;

  out.push(`# ${brief.title} 기획서`);
  out.push('');
  out.push(`> ${brief.oneLiner || brief.idea}`);
  out.push('');
  out.push('| 항목 | 내용 |');
  out.push('| --- | --- |');
  out.push(`| 타겟 사용자 | ${brief.targetUser || '-'} |`);
  out.push(`| 기획 목적 | ${brief.purpose || '-'} |`);
  out.push(`| 플랫폼 | ${PLATFORM_LABEL[brief.platform]} |`);
  out.push(`| 최종 수정 | ${new Date(plan.updatedAt).toLocaleString('ko-KR')} |`);
  out.push('');

  /* PRD */
  if (include('prd') && hasArtifact(plan, 'prd')) {
    const { prd } = plan;
    out.push('## 1. 프로덕트 요구사항 (PRD)');
    out.push('');
    out.push('### 1.1 제품 개요');
    out.push(prd.overview || '-');
    out.push('');
    out.push('### 1.2 배경 및 문제 정의');
    out.push(prd.background || '-');
    out.push('');
    out.push('### 1.3 핵심 목표');
    out.push('| 목표 | 판단 지표 |');
    out.push('| --- | --- |');
    for (const goal of prd.goals) out.push(`| ${goal.text} | ${goal.metric || '-'} |`);
    out.push('');
    out.push('### 1.4 타겟 유저');
    for (const p of prd.personas) {
      out.push(`#### ${p.name}`);
      out.push(p.summary);
      out.push('');
      out.push('**니즈**');
      out.push(bullet(p.needs));
      out.push('');
      out.push('**페인포인트**');
      out.push(bullet(p.painPoints));
      out.push('');
    }
    out.push('### 1.5 사용자 역할');
    out.push('| 역할 | 설명 | 권한 |');
    out.push('| --- | --- | --- |');
    for (const r of prd.roles) {
      out.push(`| ${r.name} | ${r.description} | ${r.permissions.join(', ')} |`);
    }
    out.push('');
    out.push('### 1.6 사용 환경');
    out.push(`- 플랫폼: ${prd.environment.platforms.join(', ') || '-'}`);
    out.push(`- 기기: ${prd.environment.devices.join(', ') || '-'}`);
    out.push(`- 브라우저/OS: ${prd.environment.browsers.join(', ') || '-'}`);
    out.push('');
    out.push('### 1.7 핵심 가치');
    out.push(bullet(prd.coreValues));
    out.push('');
    out.push('### 1.8 성공 지표');
    out.push('| 지표 | 목표 |');
    out.push('| --- | --- |');
    for (const m of prd.successMetrics) out.push(`| ${m.name} | ${m.target} |`);
    out.push('');
    out.push('### 1.9 범위');
    out.push('**포함**');
    out.push(bullet(prd.inScope));
    out.push('');
    out.push('**제외**');
    out.push(bullet(prd.outOfScope));
    out.push('');
    out.push('### 1.10 제약사항');
    out.push(bullet(prd.constraints));
    out.push('');
  }

  /* 기능명세서 */
  if (include('fs') && plan.requirements.length > 0) {
    out.push('## 2. 기능명세서 (FS)');
    out.push('');
    for (const req of [...plan.requirements].sort((a, b) => a.order - b.order)) {
      out.push(`### ${req.id} ${req.title}`);
      out.push(`- 분류: ${req.category} / 우선순위: ${PRIORITY_LABEL[req.priority]}`);
      if (req.description) out.push(`- ${req.description}`);
      out.push('');
      const features = plan.features
        .filter((f) => f.requirementId === req.id)
        .sort((a, b) => a.order - b.order);
      if (features.length > 0) {
        out.push('| 기능 ID | 기능명 | 설명 | 우선순위 | 상태 |');
        out.push('| --- | --- | --- | --- | --- |');
        for (const f of features) {
          out.push(
            `| ${f.id} | ${f.name} | ${f.description} | ${PRIORITY_LABEL[f.priority]} | ${f.status} |`,
          );
        }
        out.push('');
      }
      for (const f of features) {
        const specs = plan.specifications
          .filter((s) => s.featureId === f.id)
          .sort((a, b) => a.order - b.order);
        for (const s of specs) {
          out.push(`#### ${s.id} ${s.title}  \`${f.id} ${f.name}\``);
          out.push(`- 수행 주체: ${s.actor}`);
          out.push(`- 사전 조건: ${s.precondition || '-'}`);
          if (s.pageIds.length > 0) {
            const names = s.pageIds
              .map((pid) => plan.iaPages.find((p) => p.id === pid))
              .filter(Boolean)
              .map((p) => `${p!.id} ${p!.name}`);
            out.push(`- 연결 화면: ${names.join(', ')}`);
          }
          out.push('');
          out.push('**기본 흐름**');
          out.push(s.mainFlow.map((step, i) => `${i + 1}. ${step}`).join('\n') || '-');
          out.push('');
          out.push('**예외 처리**');
          out.push(bullet(s.exceptions));
          out.push('');
          out.push('**인수 조건**');
          out.push(bullet(s.acceptanceCriteria));
          out.push('');
        }
      }
    }
  }

  /* IA */
  if (include('ia') && plan.iaPages.length > 0) {
    out.push('## 3. 정보구조도 (IA)');
    out.push('');
    for (const { page, depth } of pageTree(plan.iaPages)) {
      out.push(`${'  '.repeat(depth)}- **${page.id} ${page.name}** \`${page.path}\``);
      if (page.description) out.push(`${'  '.repeat(depth)}  - ${page.description}`);
    }
    out.push('');
    out.push('| 페이지 ID | Depth | 페이지명 | 경로 | 유형 | 접근 역할 | 연결 기능 |');
    out.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const { page, depth } of pageTree(plan.iaPages)) {
      out.push(
        `| ${page.id} | ${depth + 1} | ${page.name} | ${page.path} | ${IA_PAGE_TYPE_LABEL[page.type]} | ${
          page.roles.join(', ') || '-'
        } | ${page.featureIds.join(', ') || '-'} |`,
      );
    }
    out.push('');
  }

  /* 유저 플로우 */
  if (include('flow') && plan.flows.length > 0) {
    out.push('## 4. 유저 플로우');
    out.push('');
    for (const flow of [...plan.flows].sort((a, b) => a.order - b.order)) {
      out.push(`### ${flow.id} ${flow.name}`);
      out.push(`- 수행 역할: ${flow.actor}`);
      if (flow.description) out.push(`- ${flow.description}`);
      out.push('');
      out.push('```mermaid');
      out.push(toMermaid(flow.id, plan));
      out.push('```');
      out.push('');
    }
  }

  /* 와이어프레임 */
  if (include('wireframe') && plan.wireframes.length > 0) {
    out.push('## 5. 와이어프레임');
    out.push('');
    for (const wf of [...plan.wireframes].sort((a, b) => a.order - b.order)) {
      const page = plan.iaPages.find((p) => p.id === wf.pageId);
      out.push(`### ${wf.id} ${wf.name}${page ? ` \`${page.path}\`` : ''}`);
      out.push(`- 기준 기기: ${wf.device === 'mobile' ? '모바일' : '데스크톱'}`);
      out.push('');
      out.push('| 순서 | 블록 | 제목 | 구성 항목 | 기획 메모 |');
      out.push('| --- | --- | --- | --- | --- |');
      wf.blocks.forEach((b, i) => {
        out.push(
          `| ${i + 1} | ${WIREFRAME_BLOCK_LABEL[b.type]} | ${b.title} | ${b.items.join(' / ')} | ${
            b.note || '-'
          } |`,
        );
      });
      out.push('');
    }
  }

  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* Mermaid (유저 플로우)                                                */
/* ------------------------------------------------------------------ */

function mermaidSafe(text: string): string {
  return text.replace(/["\n]/g, ' ').replace(/[[\]{}()]/g, '');
}

export function toMermaid(flowId: string, plan: Plan): string {
  const flow = plan.flows.find((f) => f.id === flowId);
  if (!flow) return 'flowchart TD';

  const lines = ['flowchart TD'];
  const alias = new Map<string, string>();
  flow.nodes.forEach((node, i) => alias.set(node.id, `N${i}`));

  for (const node of flow.nodes) {
    const key = alias.get(node.id)!;
    const label = mermaidSafe(node.label);
    switch (node.type) {
      case 'start':
      case 'end':
        lines.push(`  ${key}(["${label}"])`);
        break;
      case 'decision':
        lines.push(`  ${key}{"${label}"}`);
        break;
      case 'system':
        lines.push(`  ${key}[/"${label}"/]`);
        break;
      default:
        lines.push(`  ${key}["${label}"]`);
    }
  }

  for (const edge of flow.edges) {
    const from = alias.get(edge.from);
    const to = alias.get(edge.to);
    if (!from || !to) continue;
    lines.push(edge.label ? `  ${from} -->|"${mermaidSafe(edge.label)}"| ${to}` : `  ${from} --> ${to}`);
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* CSV                                                                  */
/* ------------------------------------------------------------------ */

function csvCell(value: string): string {
  const needsQuote = /[",\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

function csv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

export function featuresToCsv(plan: Plan): string {
  const rows: string[][] = [
    ['요구사항 ID', '요구사항', '기능 ID', '기능명', '기능 설명', '우선순위', '상태', '상세명세 수'],
  ];
  for (const req of [...plan.requirements].sort((a, b) => a.order - b.order)) {
    const features = plan.features
      .filter((f) => f.requirementId === req.id)
      .sort((a, b) => a.order - b.order);
    if (features.length === 0) {
      rows.push([req.id, req.title, '', '', '', PRIORITY_LABEL[req.priority], '', '0']);
      continue;
    }
    for (const f of features) {
      const specCount = plan.specifications.filter((s) => s.featureId === f.id).length;
      rows.push([
        req.id,
        req.title,
        f.id,
        f.name,
        f.description,
        PRIORITY_LABEL[f.priority],
        f.status,
        String(specCount),
      ]);
    }
  }
  return csv(rows);
}

export function iaToCsv(plan: Plan): string {
  const rows: string[][] = [
    ['페이지 ID', 'Depth', '1depth', '2depth', '3depth', '경로', '유형', '설명', '접근 역할', '연결 기능'],
  ];
  const byId = new Map(plan.iaPages.map((p) => [p.id, p]));
  for (const { page, depth } of pageTree(plan.iaPages)) {
    const names: string[] = [];
    let cursor: IaPage | undefined = page;
    while (cursor) {
      names.unshift(cursor.name);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    rows.push([
      page.id,
      String(depth + 1),
      names[0] ?? '',
      names[1] ?? '',
      names[2] ?? '',
      page.path,
      IA_PAGE_TYPE_LABEL[page.type],
      page.description,
      page.roles.join(', '),
      page.featureIds.join(', '),
    ]);
  }
  return csv(rows);
}

/* ------------------------------------------------------------------ */
/* JSON / MCP 번들                                                      */
/* ------------------------------------------------------------------ */

export function toJson(plan: Plan): string {
  return JSON.stringify(plan, null, 2);
}

/**
 * Cursor·Claude Code 같은 코딩 에이전트에 바로 물릴 수 있는 형태로 정리한 번들.
 * ID 참조를 이름까지 펼쳐서 담기 때문에 문서를 따로 열지 않아도 해석할 수 있다.
 */
export function toAgentBundle(plan: Plan): string {
  const featureById = new Map(plan.features.map((f) => [f.id, f]));
  const pageById = new Map(plan.iaPages.map((p) => [p.id, p]));
  const pageIds = plan.iaPages.filter((page) => page.type === 'page').map((page) => page.id);
  const generatedScreens = normalizeUinAiScreens(plan.uinAiScreens, pageIds);

  return JSON.stringify(
    {
      format: 'uniboard/agent-bundle',
      version: 2,
      generatedAt: new Date().toISOString(),
      product: {
        name: plan.brief.title,
        oneLiner: plan.brief.oneLiner,
        idea: plan.brief.idea,
        targetUser: plan.brief.targetUser,
        purpose: plan.brief.purpose,
        platform: PLATFORM_LABEL[plan.brief.platform],
      },
      prd: plan.prd,
      requirements: plan.requirements.map((req) => ({
        ...req,
        features: plan.features
          .filter((f) => f.requirementId === req.id)
          .map((f) => ({
            ...f,
            specifications: plan.specifications.filter((s) => s.featureId === f.id),
          })),
      })),
      informationArchitecture: pageTree(plan.iaPages).map(({ page, depth }) => ({
        ...page,
        depth: depth + 1,
        features: page.featureIds.map((fid) => featureById.get(fid)?.name).filter(Boolean),
      })),
      userFlows: plan.flows.map((flow) => ({
        ...flow,
        mermaid: toMermaid(flow.id, plan),
        nodes: flow.nodes.map((n) => ({
          ...n,
          type: FLOW_NODE_TYPE_LABEL[n.type],
          page: n.pageId ? pageById.get(n.pageId)?.name : null,
        })),
      })),
      wireframes: plan.wireframes.map((wf) => ({
        ...wf,
        page: pageById.get(wf.pageId)?.name ?? null,
        path: pageById.get(wf.pageId)?.path ?? null,
        blocks: wf.blocks.map((b) => ({ ...b, type: WIREFRAME_BLOCK_LABEL[b.type] })),
      })),
      generatedUi: {
        generator: 'UniAI',
        screens: generatedScreens.map((screen) => {
          const page = pageById.get(screen.pageId);
          const currentSourceSignature = uinAiSourceSignature(plan, screen.pageId);
          const stale = screen.sourceSignature !== currentSourceSignature;
          return {
            ...screen,
            route: page?.path ?? screen.route,
            status: stale ? 'stale' : 'current',
            stale,
            currentSourceSignature,
            pageDescription: page?.description ?? '',
            features: (page?.featureIds ?? [])
              .map((featureId) => featureById.get(featureId))
              .filter(Boolean)
              .map((feature) => ({
                id: feature!.id,
                name: feature!.name,
                description: feature!.description,
              })),
          };
        }),
        instruction: `${UINAI_AGENT_PROMPT} status가 stale인 화면은 구현 기준으로 쓰지 마세요.`,
      },
      coverage: (Object.keys(ARTIFACT_LABEL) as ArtifactKey[]).map((key) => ({
        artifact: ARTIFACT_LABEL[key],
        generated: hasArtifact(plan, key),
      })),
    },
    null,
    2,
  );
}

/* ------------------------------------------------------------------ */
/* 다운로드 헬퍼                                                        */
/* ------------------------------------------------------------------ */

export function download(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function slugify(text: string): string {
  return (
    text
      .trim()
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 40) || 'plan'
  );
}
