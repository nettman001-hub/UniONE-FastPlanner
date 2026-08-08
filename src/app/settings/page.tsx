import { redirect } from 'next/navigation';

/** `/settings` 로 들어오면 첫 항목으로 보낸다. 빈 화면을 보여 줄 이유가 없다. */
export default function SettingsIndex() {
  redirect('/settings/account');
}
