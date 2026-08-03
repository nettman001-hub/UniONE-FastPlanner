import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui';
import { AuthProvider } from '@/lib/auth/client';
import { PlanSync } from '@/components/Account';

// 로고 파일이 있을 때만 파비콘으로 쓴다. 없는 경로를 걸면 매 페이지마다 400 이 난다.
const hasLogo = process.env.NEXT_PUBLIC_HAS_LOGO === '1';

export const metadata: Metadata = {
  title: 'UniONE FastPlanner — AI 기획 에디터',
  ...(hasLogo ? { icons: { icon: '/logo.png', apple: '/logo.png' } } : {}),
  description:
    '서비스 아이디어를 입력하면 PRD, 기능명세서, 정보구조도, 유저 플로우, 와이어프레임까지 한 번에 만들고 함께 다듬는 AI 기획 에디터.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        <AuthProvider>
          <ToastProvider>
            {/* 그리는 것은 없다. 로그인 상태에 맞춰 플랜을 서버와 맞춘다. */}
            <PlanSync />
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
