import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * public/logo.png 가 있는지 빌드 시점에 확인한다.
 *
 * 없는 상태에서 <img src="/logo.png"> 를 그리면 Next 가 400 을 돌려주어
 * 페이지마다 콘솔 오류가 남는다. 미리 알고 있으면 요청 자체를 하지 않는다.
 * 로고 파일을 새로 넣었다면 서버를 다시 시작해야 반영된다.
 */
export const hasBrandLogo = existsSync(path.join(process.cwd(), 'public', 'logo.png'));

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_HAS_LOGO: hasBrandLogo ? '1' : '',
  },
  /**
   * DB 드라이버는 번들에 넣지 않고 실행 시점에 불러온다.
   *
   * PGlite 는 WASM 을 들고 다니는 개발용 의존성이라 배포 번들에 섞이면 안 되고,
   * `pg` 는 네이티브 경로를 런타임에 고르므로 번들러가 손대면 깨진다.
   * DATABASE_URL 이 있는 배포에서는 PGlite 를 아예 부르지 않는다.
   */
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
};

export default nextConfig;
