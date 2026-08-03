import { notFound } from 'next/navigation';
import { MarkdownView } from '@/components/MarkdownView';
import { allDocs, findDoc, docLinkMap, readDoc, DOCS_INDEX_SLUG } from '@/lib/docs';

/** 설명서 홈 — `doc/README.md` 를 그대로 보여 준다. */
export default async function DocsHome() {
  const page = await findDoc(DOCS_INDEX_SLUG);
  if (!page) notFound();

  const [markdown, pages] = await Promise.all([readDoc(page), allDocs()]);

  return (
    <article className="card p-5 sm:p-7">
      <MarkdownView markdown={markdown} linkMap={docLinkMap(pages)} />
    </article>
  );
}
