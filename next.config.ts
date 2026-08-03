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
};

export default nextConfig;
