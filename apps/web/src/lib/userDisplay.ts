import type { User } from '../types';

/** 顶栏等：同时有中英文名时显示为「中文名 英文名」，否则退化为单列名或 displayName / username */
export function formatNavUserLabel(u: Pick<User, 'nameZh' | 'nameEn' | 'displayName' | 'username'>): string {
  const zh = (u.nameZh ?? '').trim();
  const en = (u.nameEn ?? '').trim();
  if (zh && en) return `${zh} ${en}`;
  if (zh) return zh;
  if (en) return en;
  const d = (u.displayName ?? '').trim();
  if (d) return d;
  return u.username;
}
