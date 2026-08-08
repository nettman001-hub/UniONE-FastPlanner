/**
 * 관리자 화면의 껍데기.
 *
 * **관리자가 아니면 404 다.** 403 은 "여기 뭔가 있다" 를 알려 주는 셈이라,
 * 있는지조차 모르는 편이 낫다.
 *
 * 서버에서 가른다. 화면에서 감추는 것은 표시일 뿐이고, 주소를 아는 사람은
 * 그냥 들어온다. 여기서 막아야 진짜로 막힌다.
 */

import { notFound } from 'next/navigation';

import { currentAdmin } from '@/lib/auth/admin';
import { AdminShell } from '@/components/admin/AdminShell';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await currentAdmin();
  if (!admin) notFound();

  return <AdminShell email={admin.email}>{children}</AdminShell>;
}
