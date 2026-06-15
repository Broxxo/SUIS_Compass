/**
 * 钉钉家校班级名 → 本校班名（如 八年级1班 → S8A，二年级6班 → P2G）
 * 规则见 README「钉钉班级与本地班名对应」
 */

const CN_DIGIT: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseChineseNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  if (s === '十') return 10;
  if (s.startsWith('十') && s.length === 2) return 10 + (CN_DIGIT[s[1]] ?? 0);
  if (s.endsWith('十') && s.length === 2) return (CN_DIGIT[s[0]] ?? 0) * 10;
  if (s.includes('十')) {
    const [a, b] = s.split('十');
    const tens = a ? (CN_DIGIT[a] ?? 0) : 0;
    const ones = b ? (CN_DIGIT[b] ?? 0) : 0;
    return tens * 10 + ones;
  }
  const one = CN_DIGIT[s];
  return one ?? null;
}

export function parseGradeFromText(text: string): number | null {
  const s = text.trim();
  if (!s) return null;
  const digitMatch = s.match(/(?:^|[^\d])([1-9]|1[0-2])\s*年级/);
  if (digitMatch) return Number(digitMatch[1]);
  const cnMatch = s.match(/([一二三四五六七八九十]+)\s*年级/);
  if (cnMatch) return parseChineseNumber(cnMatch[1]);
  const gMatch = s.match(/\bG\s*([1-9]|1[0-2])\b/i);
  if (gMatch) return Number(gMatch[1]);
  return null;
}

export function parseClassIndexFromText(text: string): number | null {
  const s = text.trim();
  if (!s) return null;
  const digitMatch = s.match(/(\d+)\s*班/);
  if (digitMatch) {
    const n = Number(digitMatch[1]);
    return n >= 1 && n <= 26 ? n : null;
  }
  const cnMatch = s.match(/([一二三四五六七八九十]+)\s*班/);
  if (cnMatch) {
    const n = parseChineseNumber(cnMatch[1]);
    return n != null && n >= 1 && n <= 26 ? n : null;
  }
  const letterMatch = s.match(/([A-Da-d])\s*班?/);
  if (letterMatch) return letterMatch[1].toUpperCase().charCodeAt(0) - 64;
  const trailingLetter = s.match(/([A-Da-d])$/);
  if (trailingLetter) return trailingLetter[1].toUpperCase().charCodeAt(0) - 64;
  return null;
}

export function segmentPrefixForGrade(grade: number): 'P' | 'S' {
  return grade <= 6 ? 'P' : 'S';
}

export function classLetterForIndex(index: number): string {
  if (index < 1 || index > 26) return '';
  // 1–5 班 → A–E；6 班 → G（跳过 F）；7 班起继续 H、I…
  const code = index >= 6 ? 64 + index + 1 : 64 + index;
  return String.fromCharCode(code);
}

export function toLocalClassName(grade: number, classIndex: number): string {
  if (grade < 1 || grade > 12 || classIndex < 1 || classIndex > 26) return '';
  return `${segmentPrefixForGrade(grade)}${grade}${classLetterForIndex(classIndex)}`;
}

export function classIndexFromLocalClassName(className: string, grade: number): number {
  const compact = className.replace(/\s+/g, '').toUpperCase();
  let rest = compact;
  if (rest.startsWith('P') || rest.startsWith('S')) rest = rest.slice(1);
  const m = rest.match(new RegExp(`^${grade}([A-Z])`));
  if (!m) return 1;
  const code = m[1].charCodeAt(0);
  // A–E → 1–5；G 起跳过 F，与 classLetterForIndex 互逆
  if (code <= 69) return code - 64;
  return code - 65;
}

function resolveGradeForMapping(input: {
  className: string;
  gradeName?: string | null;
  gradeLevel?: number | null;
  classPath?: string | null;
}): number | null {
  const parts = [input.gradeName, input.classPath, input.className].filter(Boolean).join(' ');
  const fromText =
    parseGradeFromText(input.gradeName ?? '')
    ?? parseGradeFromText(input.classPath ?? '')
    ?? parseGradeFromText(parts)
    ?? parseGradeFromText(input.className ?? '');

  const fromLevel =
    input.gradeLevel != null && input.gradeLevel >= 1 && input.gradeLevel <= 12
      ? input.gradeLevel
      : null;

  // 初中学段钉钉 feature.grade_level 常为 1–3（相对学段），与「七/八/九年级」文字冲突时必须以文字为准
  if (fromText != null) return fromText;
  return fromLevel;
}

export function resolveLocalClassNameFromDingTalk(input: {
  className: string;
  gradeName?: string | null;
  gradeLevel?: number | null;
  classPath?: string | null;
}): string | null {
  const grade = resolveGradeForMapping(input);

  const parts = [input.gradeName, input.className, input.classPath].filter(Boolean).join(' ');
  const classIndex =
    parseClassIndexFromText(input.className ?? '')
    ?? parseClassIndexFromText(parts)
    ?? parseClassIndexFromText(input.classPath ?? '');

  if (grade == null || classIndex == null) return null;
  return toLocalClassName(grade, classIndex);
}

export type LocalClassRow = {
  id: string;
  name: string;
  grade: number;
  academic_year_id: string;
};

export function matchDingTalkStudentToLocalClass(
  dingtalk: {
    className: string;
    gradeName?: string | null;
    gradeLevel?: number | null;
    classPath?: string | null;
  },
  localClasses: LocalClassRow[],
): { classId: string; className: string; grade: number } | null {
  const expectedName = resolveLocalClassNameFromDingTalk(dingtalk);
  if (!expectedName) return null;

  const exact = localClasses.find((c) => c.name.trim().toUpperCase() === expectedName.toUpperCase());
  if (exact) {
    return { classId: exact.id, className: exact.name, grade: exact.grade };
  }

  return null;
}

/** 一次解析期望班名与本地班级匹配，供同步计划/应用复用 */
export function resolveDingTalkClassMatch(
  dingtalk: {
    className: string;
    gradeName?: string | null;
    gradeLevel?: number | null;
    classPath?: string | null;
  },
  localClasses: LocalClassRow[],
): {
  expectedLocalClassName: string | null;
  classMatch: { classId: string; className: string; grade: number } | null;
} {
  const expectedLocalClassName = resolveLocalClassNameFromDingTalk(dingtalk);
  if (!expectedLocalClassName) {
    return { expectedLocalClassName: null, classMatch: null };
  }
  const classMatch = matchDingTalkStudentToLocalClass(dingtalk, localClasses);
  return { expectedLocalClassName, classMatch };
}
