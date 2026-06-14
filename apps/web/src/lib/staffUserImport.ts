/**
 * 教职工批量导入：Excel 解析、登录名生成、模板下载（用户管理）
 */
import * as XLSX from 'xlsx';
import { pinyin } from 'pinyin-pro';

/** 含中日韩及兼容扩展汉字 */
const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

export type StaffCreateDraftRow = {
  id: string;
  nameZh: string;
  nameEn: string;
  username: string;
  role: 'admin' | 'teacher';
  department: string;
  primarySubject: string;
  password: string;
};

export type StaffImportParsedRow = {
  nameZh: string;
  nameEn: string;
  role: 'admin' | 'teacher';
  department: string;
  primarySubject: string;
  passwordFromFile: string;
};

/** 密码：2 位小写字母 + 4 位数字（测试用） */
export function generateRandomImportPassword(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 2; i += 1) {
    s += letters[Math.floor(Math.random() * 26)];
  }
  for (let i = 0; i < 4; i += 1) {
    s += String(Math.floor(Math.random() * 10));
  }
  return s;
}

function slugifyLatinLogin(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const parts = t.split(/\s+/).filter(Boolean);
  const token = parts.length > 1 ? parts[0] : t;
  return token
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** 用于生成登录名：优先中文名拼音，否则英文名拉丁化 */
export function nameSlugSource(nameZh: string, nameEn: string): string {
  const zh = nameZh.trim();
  const en = nameEn.trim();
  if (zh) {
    if (CJK_RE.test(zh)) {
      const raw = pinyin(zh, { toneType: 'none', type: 'string', separator: '' });
      return String(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    return slugifyLatinLogin(zh);
  }
  return slugifyLatinLogin(en);
}

/**
 * slugBases 为已规范化的小写片段（通常来自 nameSlugSource）；与已有 taken 去重后返回完整登录名。
 */
export function allocateLoginNames(slugBases: string[], taken: Set<string>): string[] {
  const out: string[] = [];
  for (const raw of slugBases) {
    let base = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!base) base = 'user';
    let n = 0;
    let cand = base;
    while (taken.has(cand.toLowerCase())) {
      n += 1;
      cand = `${base}${n}`;
    }
    taken.add(cand.toLowerCase());
    out.push(cand);
  }
  return out;
}

function parseRoleCell(raw: string): 'admin' | 'teacher' | null {
  const t = raw.trim();
  if (!t) return 'teacher';
  if (/管理|admin/i.test(t) && !/教师|老师/.test(t)) return 'admin';
  if (/教职工|教师|老师|teacher|staff|user/i.test(t)) return 'teacher';
  if (t.toLowerCase() === 'admin') return 'admin';
  if (t.toLowerCase() === 'teacher') return 'teacher';
  return null;
}

export function normalizeImportRole(
  raw: string,
  allowed: readonly ('admin' | 'teacher')[],
): 'admin' | 'teacher' {
  const parsed = parseRoleCell(raw);
  const r = parsed ?? 'teacher';
  if ((allowed as readonly string[]).includes(r)) return r;
  if ((allowed as readonly string[]).includes('teacher')) return 'teacher';
  return allowed[0] ?? 'teacher';
}

/** 首行若第 3 列为权限/Role 则视为表头 */
function isLikelyHeaderRow(row: unknown[]): boolean {
  const c2 = String(row[2] ?? '').trim();
  return /权限|role|access/i.test(c2);
}

/**
 * 列：A 中文名、B 英文名、C 权限、D 部门、E 主学科、F 密码（可空）；中文名与英文名至少填其一。
 */
export function parseStaffImportWorkbook(
  arrayBuffer: ArrayBuffer,
  allowedRoles: readonly ('admin' | 'teacher')[],
): StaffImportParsedRow[] {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sh = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sh, {
    header: 1,
    defval: '',
  }) as string[][];
  if (data.length === 0) return [];
  let start = 0;
  if (isLikelyHeaderRow(data[0] as unknown[])) {
    start = 1;
  }
  const out: StaffImportParsedRow[] = [];
  for (let i = start; i < data.length; i += 1) {
    const r = data[i] as unknown[];
    const nameZh = String(r[0] ?? '').trim();
    const nameEn = String(r[1] ?? '').trim();
    if (!nameZh && !nameEn) continue;
    const role = normalizeImportRole(String(r[2] ?? ''), allowedRoles);
    const department = String(r[3] ?? '').trim();
    const primarySubject = String(r[4] ?? '').trim();
    const passwordFromFile = String(r[5] ?? '').trim();
    out.push({ nameZh, nameEn, role, department, primarySubject, passwordFromFile });
  }
  return out;
}

export function downloadStaffImportTemplate(isZh: boolean): void {
  const header = isZh
    ? [['中文名', '英文名', '权限', '部门', '主学科', '密码']]
    : [['Name (ZH)', 'Name (EN)', 'Role', 'Department', 'Primary subject', 'Password']];
  const example = isZh
    ? [
        ['张三', 'San Zhang', '教职工', '数学组', '数学', ''],
        ['', 'Mary Smith', '教职工', '外语组', '英语', 'ab1234'],
      ]
    : [
        ['Zhang San', 'San Zhang', 'Teacher', 'Math', 'Math', ''],
        ['', 'Mary Smith', 'Teacher', 'English', 'English', 'ab1234'],
      ];
  const ws = XLSX.utils.aoa_to_sheet([...header, ...example]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, isZh ? '教职工' : 'Staff');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = isZh ? '教职工导入模板.xlsx' : 'staff-import-template.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

/** 与导入模板相同的列，用于从用户列表导出（仅 admin / teacher 可再导入） */
export type StaffUserExportSource = {
  nameZh?: string | null;
  nameEn?: string | null;
  displayName: string;
  role: 'admin' | 'teacher' | 'system-admin' | 'student';
  department?: string | null;
  primarySubject?: string | null;
  password?: string | null;
};

function staffExportRoleLabel(role: 'admin' | 'teacher', isZh: boolean): string {
  if (isZh) return role === 'admin' ? '管理员' : '教职工';
  return role === 'admin' ? 'Admin' : 'Staff';
}

/**
 * 导出为与 `downloadStaffImportTemplate` 相同表头的 xlsx（表头 + 数据行，无示例行）。
 * 仅导出 role 为 admin/teacher 的用户；密码列有明文则写出，否则留空（再导入时随机）。
 */
export function downloadStaffUsersExport(users: readonly StaffUserExportSource[], isZh: boolean): void {
  const rows = users.filter((u) => u.role === 'admin' || u.role === 'teacher');
  const header = isZh
    ? [['中文名', '英文名', '权限', '部门', '主学科', '密码']]
    : [['Name (ZH)', 'Name (EN)', 'Role', 'Department', 'Primary subject', 'Password']];
  const body = rows.map((u) => {
    const nz = (u.nameZh ?? '').trim();
    const ne = (u.nameEn ?? '').trim();
    const legacy = (u.displayName ?? '').trim();
    const nameZh = nz || (!ne && legacy ? legacy : nz);
    const nameEn = ne;
    const roleKey: 'admin' | 'teacher' = u.role === 'admin' ? 'admin' : 'teacher';
    const role = staffExportRoleLabel(roleKey, isZh);
    const department = (u.department ?? '').trim();
    const primarySubject = (u.primarySubject ?? '').trim();
    const password = (u.password ?? '').trim();
    return [nameZh, nameEn, role, department, primarySubject, password];
  });
  const ws = XLSX.utils.aoa_to_sheet([...header, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, isZh ? '教职工' : 'Staff');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = isZh ? `教职工导出-${stamp}.xlsx` : `staff-export-${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parsedRowsToDrafts(
  parsed: StaffImportParsedRow[],
  logins: string[],
  makeId: () => string,
): StaffCreateDraftRow[] {
  return parsed.map((row, i) => ({
    id: makeId(),
    nameZh: row.nameZh,
    nameEn: row.nameEn,
    username: logins[i] ?? '',
    role: row.role,
    department: row.department,
    primarySubject: row.primarySubject,
    password: row.passwordFromFile || generateRandomImportPassword(),
  }));
}
