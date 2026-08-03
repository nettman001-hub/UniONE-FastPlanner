'use client';

import { useState } from 'react';
import { BRAND_LOGO_SRC, BRAND_NAME } from '@/lib/brand';

/**
 * 로고 마크.
 *
 * public/logo.png 가 있으면 그 이미지를, 없거나 로드에 실패하면 이니셜 마크를 그린다.
 * 이미지 파일 유무에 따라 화면이 깨지지 않게 하기 위한 처리다.
 */
/** 빌드 시점에 확인한 public/logo.png 존재 여부 (next.config.ts 에서 주입). */
const HAS_LOGO = process.env.NEXT_PUBLIC_HAS_LOGO === '1';

export function Logo({ size = 24, className = '' }: { size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);

  if (!HAS_LOGO || broken) {
    return (
      <span
        className={`inline-grid shrink-0 place-items-center rounded-md bg-[var(--primary)] font-extrabold text-[var(--primary-fg)] ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.46, letterSpacing: '-0.03em' }}
        aria-hidden
      >
        UF
      </span>
    );
  }

  return (
    // 로고 파일 크기를 알 수 없어 next/image 대신 img 를 쓴다. (파일 부재 시 onError 폴백도 필요)
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={BRAND_LOGO_SRC}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 rounded-md object-contain ${className}`}
      style={{ width: size, height: size }}
      onError={() => setBroken(true)}
    />
  );
}

/** 로고 + 서비스명을 함께 쓰는 워드마크. */
export function Wordmark({
  size = 24,
  textClassName = 'text-[15px] font-extrabold tracking-tight',
}: {
  size?: number;
  textClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Logo size={size} />
      <span className={textClassName}>{BRAND_NAME}</span>
    </span>
  );
}
