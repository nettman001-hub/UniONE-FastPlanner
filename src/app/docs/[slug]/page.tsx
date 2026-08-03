import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MarkdownView } from '@/components/MarkdownView';
import { allDocs, docNav, findDoc, docLinkMap, readDoc } from '@/lib/docs';
import { BRAND_NAME } from '@/lib/brand';

/** 목차에 있는 문서만 만든다. 없는 주소는 404 — 실행 중에 파일을 찾지 않는다. */
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await docNav()).map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await findDoc(slug);
  return { title: page ? `${page.title} — ${BRAND_NAME} 설명서` : '설명서' };
}

export default async function DocPageView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await findDoc(slug);
  if (!page) notFound();

  const [markdown, pages, nav] = await Promise.all([readDoc(page), allDocs(), docNav()]);
  const index = nav.findIndex((p) => p.slug === slug);
  const prev = index > 0 ? nav[index - 1] : null;
  const next = index >= 0 && index < nav.length - 1 ? nav[index + 1] : null;

  return (
    <div className="flex flex-col gap-4">
      <article className="card p-5 sm:p-7">
        <MarkdownView markdown={markdown} linkMap={docLinkMap(pages)} />
      </article>

      <nav className="no-print flex flex-wrap items-center justify-between gap-2">
        {prev ? (
          <Link href={`/docs/${prev.slug}`} className="btn btn-sm">
            <ChevronLeft size={14} />
            {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={`/docs/${next.slug}`} className="btn btn-sm">
            {next.title}
            <ChevronRight size={14} />
          </Link>
        )}
      </nav>
    </div>
  );
}
