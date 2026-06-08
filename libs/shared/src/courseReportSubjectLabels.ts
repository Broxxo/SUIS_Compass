import { staffingSubjectKeyFromCourse } from './staffingSubjectKey.js';

export type CourseLabelSource = {
  id: string;
  name: string;
  subjectCategory?: { zh?: string; en?: string } | string | null;
};

function firstSegmentOfCompoundCourseName(name: string): string {
  const t = (name || '').trim();
  if (!t) return '';
  const parts = t.split(/[－\-–—]/u).map((s) => s.trim()).filter(Boolean);
  return parts[0] ?? t;
}

function parseCourseCategoryZhEn(course: CourseLabelSource): { zh: string; en: string } {
  let zh = '';
  let en = '';
  const sc = course.subjectCategory;
  if (sc && typeof sc === 'object' && 'zh' in sc) {
    zh = String(sc.zh ?? '').trim();
    en = String(sc.en ?? '').trim();
  } else if (typeof sc === 'string') {
    zh = sc.trim();
  }
  return { zh, en };
}

/** 学业报告模板库学科中英文名（与课程管理、岗位 subject_key 一致） */
export function getCourseReportSubjectLabels(course: CourseLabelSource): {
  subjectNameZh: string;
  subjectNameEn: string;
} {
  const { zh, en } = parseCourseCategoryZhEn(course);
  const fb = firstSegmentOfCompoundCourseName(course.name);
  const nameTrim = (course.name || '').trim();
  const subjectNameZh = zh || fb || nameTrim;
  const subjectNameEn = en || subjectNameZh;
  return { subjectNameZh, subjectNameEn };
}

export function presetSubjectKeyFromCourse(course: CourseLabelSource): string {
  return staffingSubjectKeyFromCourse(course.id, course.name);
}
