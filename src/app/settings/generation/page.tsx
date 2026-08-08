'use client';

/** 아직 못 쓰는 자리. 왜 아직인지는 `settings-nav` 한 곳에 적어 두고 여기서 읽는다. */

import { SoonPanel } from '@/components/settings/Parts';
import { findSettingsItem } from '@/lib/settings-nav';

export default function Soon() {
  const item = findSettingsItem('generation');
  if (!item) return null;
  return <SoonPanel title={item.name} what={item.what} why={item.soon ?? ''} />;
}
