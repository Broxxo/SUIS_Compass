import type { Pool, PoolClient } from 'pg';
import { classIndexFromLocalClassName } from './classNameMapping.js';

/** 学号格式 YYGCCSS：入学年两位 + 年级 + 班序号(2) + 班内序号(2)，与登录用户名一致 */
export function entryYearShortCode(
  startYear: string | null | undefined,
  academicYearName: string,
): string {
  const raw = startYear?.trim() ?? '';
  if (raw) {
    const four = raw.match(/(20\d{2})/)?.[1];
    if (four) return four.slice(-2);
    if (/^\d{2}$/.test(raw)) return raw;
  }
  const fromYear = academicYearName.match(/(20\d{2})/)?.[1];
  if (fromYear) return fromYear.slice(-2);
  return String(new Date().getFullYear()).slice(-2);
}

export function buildStudentNumber(
  yearShort: string,
  grade: number,
  classIndex: number,
  seat: number,
): string {
  return `${yearShort}${grade}${String(classIndex).padStart(2, '0')}${String(seat).padStart(2, '0')}`;
}

export function studentNumberPrefix(
  yearShort: string,
  grade: number,
  classIndex: number,
): string {
  return `${yearShort}${grade}${String(classIndex).padStart(2, '0')}`;
}

function normalizeStudentNo(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  return trimmed ? trimmed : null;
}

/** 钉钉班级内序号常为 1–2 位；本校登录学号格式 YYGCCSS 至少 7 位（G10+ 为 8 位） */
export function shouldUseDingTalkStudentNo(raw: string | null | undefined): boolean {
  const normalized = normalizeStudentNo(raw);
  if (!normalized) return false;
  if (!/^\d+$/.test(normalized)) return true;
  return normalized.length >= 7;
}

export function effectiveDingTalkStudentNo(raw: string | null | undefined): string | null {
  const normalized = normalizeStudentNo(raw);
  if (!normalized || !shouldUseDingTalkStudentNo(normalized)) return null;
  return normalized;
}

function parseSeatFromNumber(studentNumber: string, prefix: string): number | null {
  const sn = studentNumber.trim();
  if (!sn.startsWith(prefix) || sn.length !== prefix.length + 2) return null;
  const seat = Number.parseInt(sn.slice(-2), 10);
  return Number.isFinite(seat) && seat >= 1 ? seat : null;
}

export async function loadMaxSeatByClassPrefix(
  client: Pool | PoolClient,
  academicYearId: string,
): Promise<Map<string, number>> {
  const rows = (await client.query(
    `SELECT e.class_id, s.student_number
     FROM students s
     JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $1
     WHERE s.student_number IS NOT NULL AND TRIM(s.student_number) <> ''`,
    [academicYearId],
  )).rows as Array<{ class_id: string; student_number: string }>;

  const maxByClass = new Map<string, number>();
  for (const row of rows) {
    const sn = row.student_number.trim();
    if (sn.length < 5) continue;
    const seat = Number.parseInt(sn.slice(-2), 10);
    if (!Number.isFinite(seat)) continue;
    const prev = maxByClass.get(row.class_id) ?? 0;
    if (seat > prev) maxByClass.set(row.class_id, seat);
  }
  return maxByClass;
}

export type StudentNumberAllocator = {
  client: PoolClient;
  academicYearId: string;
  academicYearName: string;
  usedInBatch: Set<string>;
  classNextSeat: Map<string, number>;
};

export type ResolveStudentNumberInput = StudentNumberAllocator & {
  dingtalkStudentNo: string | null | undefined;
  startYear: string | null | undefined;
  classId: string;
  className: string;
  grade: number;
};

export async function allocateAutoStudentNumber(
  input: Omit<ResolveStudentNumberInput, 'dingtalkStudentNo'>,
): Promise<string> {
  const yearShort = entryYearShortCode(input.startYear, input.academicYearName);
  const classIndex = classIndexFromLocalClassName(input.className, input.grade);
  const prefix = studentNumberPrefix(yearShort, input.grade, classIndex);

  let seat = input.classNextSeat.get(input.classId);
  if (seat == null) {
    const maxInClass = (await input.client.query(
      `SELECT s.student_number
       FROM students s
       JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $1
       WHERE e.class_id = $2 AND s.student_number IS NOT NULL`,
      [input.academicYearId, input.classId],
    )).rows as Array<{ student_number: string }>;

    let maxSeat = 0;
    for (const row of maxInClass) {
      const parsed = parseSeatFromNumber(String(row.student_number), prefix);
      if (parsed != null && parsed > maxSeat) maxSeat = parsed;
    }
    seat = maxSeat + 1;
    input.classNextSeat.set(input.classId, seat);
  }

  for (let guard = 0; guard < 200; guard += 1) {
    const candidate = buildStudentNumber(yearShort, input.grade, classIndex, seat);
    if (!input.usedInBatch.has(candidate)) {
      const taken = (await input.client.query(
        'SELECT 1 FROM students WHERE student_number = $1 LIMIT 1',
        [candidate],
      )).rows.length > 0;
      if (!taken) {
        input.usedInBatch.add(candidate);
        input.classNextSeat.set(input.classId, seat + 1);
        return candidate;
      }
    }
    seat += 1;
  }

  throw new Error(`无法为班级 ${input.className} 分配学号`);
}

/** 预览下一学号（同步计划展示，不写入 usedInBatch） */
export function peekAutoStudentNumber(
  input: {
    startYear: string | null | undefined;
    academicYearName: string;
    classId: string;
    className: string;
    grade: number;
    classNextSeat: Map<string, number>;
    maxSeatByClass: Map<string, number>;
  },
): string {
  const yearShort = entryYearShortCode(input.startYear, input.academicYearName);
  const classIndex = classIndexFromLocalClassName(input.className, input.grade);
  const seat =
    input.classNextSeat.get(input.classId)
    ?? (input.maxSeatByClass.get(input.classId) ?? 0) + 1;
  input.classNextSeat.set(input.classId, seat + 1);
  return buildStudentNumber(yearShort, input.grade, classIndex, seat);
}

export async function resolveStudentNumberForSyncInsert(
  input: ResolveStudentNumberInput,
): Promise<{ value: string; note: string | null }> {
  const normalized = effectiveDingTalkStudentNo(input.dingtalkStudentNo);
  const rawDingTalk = normalizeStudentNo(input.dingtalkStudentNo);
  if (normalized && !input.usedInBatch.has(normalized)) {
    const taken = (await input.client.query(
      'SELECT id FROM students WHERE student_number = $1 LIMIT 1',
      [normalized],
    )).rows.length > 0;
    if (!taken) {
      input.usedInBatch.add(normalized);
      return { value: normalized, note: null };
    }
  }

  const generated = await allocateAutoStudentNumber(input);
  if (!rawDingTalk) {
    return { value: generated, note: `已自动生成学号 ${generated}` };
  }
  if (!shouldUseDingTalkStudentNo(rawDingTalk)) {
    return { value: generated, note: `钉钉学号 ${rawDingTalk} 为班内序号，已规范为 ${generated}` };
  }
  if (input.usedInBatch.has(normalized!)) {
    return { value: generated, note: `钉钉学号 ${normalized} 在本批重复，已自动生成 ${generated}` };
  }
  return { value: generated, note: `钉钉学号 ${normalized} 已被占用，已自动生成 ${generated}` };
}

export async function resolveStudentNumberForSyncUpdate(
  input: ResolveStudentNumberInput & { studentId: string; existingStudentNumber: string | null },
): Promise<{ value: string | null; note: string | null }> {
  const normalized = effectiveDingTalkStudentNo(input.dingtalkStudentNo);
  const rawDingTalk = normalizeStudentNo(input.dingtalkStudentNo);
  const existing = normalizeStudentNo(input.existingStudentNumber);
  const existingOk = existing && shouldUseDingTalkStudentNo(existing);

  if (normalized) {
    if (input.usedInBatch.has(normalized)) {
      if (existingOk) return { value: null, note: null };
      const generated = await allocateAutoStudentNumber(input);
      return { value: generated, note: `钉钉学号 ${normalized} 冲突，已自动生成 ${generated}` };
    }
    const taken = (await input.client.query(
      'SELECT id FROM students WHERE student_number = $1 AND id <> $2 LIMIT 1',
      [normalized, input.studentId],
    )).rows.length > 0;
    if (!taken) {
      input.usedInBatch.add(normalized);
      return { value: normalized, note: null };
    }
    if (existingOk) return { value: null, note: null };
    const generated = await allocateAutoStudentNumber(input);
    return { value: generated, note: `钉钉学号 ${normalized} 已被占用，已自动生成 ${generated}` };
  }

  if (existingOk) return { value: null, note: null };

  const generated = await allocateAutoStudentNumber(input);
  if (existing && !shouldUseDingTalkStudentNo(existing)) {
    return { value: generated, note: `原学号 ${existing} 为钉钉班内序号，已规范为 ${generated}` };
  }
  if (rawDingTalk && !shouldUseDingTalkStudentNo(rawDingTalk)) {
    return { value: generated, note: `钉钉学号 ${rawDingTalk} 为班内序号，已规范为 ${generated}` };
  }
  return { value: generated, note: `已自动生成学号 ${generated}` };
}
