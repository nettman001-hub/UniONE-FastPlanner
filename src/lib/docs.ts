/**
 * 설명서 읽기.
 *
 * `doc/` 폴더의 마크다운과 `doc/manifest.json` 목차를 그대로 쓴다.
 * 설명서를 고치면 `/docs` 화면도 함께 바뀌므로, 같은 내용을 두 벌 관리하지 않는다.
 *
 * **빌드 시점에만 읽는다.** `/docs` 화면은 정적으로 미리 만들어지므로 실행 중에는
 * 파일을 건드리지 않는다. 그래서 서버리스에 올려도 파일이 없어 깨질 일이 없다.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface DocPage {
  slug: string;
  /** doc/ 안의 파일명 */
  file: string;
  title: string;
  summary: string;
}

interface Manifest {
  title: string;
  pages: DocPage[];
}

const DOC_DIR = path.join(process.cwd(), 'doc');

/** 설명서 홈으로 쓰는 슬러그. 목록에서는 따로 보여 주지 않는다. */
export const DOCS_INDEX_SLUG = 'index';

async function manifest(): Promise<Manifest> {
  const raw = await readFile(path.join(DOC_DIR, 'manifest.json'), 'utf8');
  return JSON.parse(raw) as Manifest;
}

export async function docsTitle(): Promise<string> {
  return (await manifest()).title;
}

/** 목차 전체 (홈 포함). */
export async function allDocs(): Promise<DocPage[]> {
  return (await manifest()).pages;
}

/** 사이드바에 늘어놓을 문서 (홈 제외). */
export async function docNav(): Promise<DocPage[]> {
  return (await manifest()).pages.filter((page) => page.slug !== DOCS_INDEX_SLUG);
}

export async function findDoc(slug: string): Promise<DocPage | undefined> {
  return (await manifest()).pages.find((page) => page.slug === slug);
}

export async function readDoc(page: DocPage): Promise<string> {
  // 파일명은 manifest 가 정하지만, 경로를 벗어나지 못하게 이름만 취한다.
  return readFile(path.join(DOC_DIR, path.basename(page.file)), 'utf8');
}

/**
 * 문서 안의 상대 링크를 앱 경로로 옮길 대응표.
 *
 * `./06-troubleshooting.md#크레딧` → `/docs/troubleshooting`
 * 표에 없는 주소(저장소 루트 `../README.md`, 바깥 링크)는 그대로 둔다.
 */
export function docLinkMap(pages: DocPage[]): Record<string, string> {
  return Object.fromEntries(
    pages.map((page) => [
      page.file,
      page.slug === DOCS_INDEX_SLUG ? '/docs' : `/docs/${page.slug}`,
    ]),
  );
}
