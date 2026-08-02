import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui';

export const metadata: Metadata = {
  title: 'UniONE FastPlaner — AI 기획 에디터',
  description:
    '서비스 아이디어를 입력하면 PRD, 기능명세서, 정보구조도, 유저 플로우, 와이어프레임까지 한 번에 만들고 함께 다듬는 AI 기획 에디터.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
