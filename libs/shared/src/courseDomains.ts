import type { Course, CourseColor, SubjectCategory } from './types.js';

export type CourseDomainLabel = {
  zh: string;
  en: string;
};

export type CourseDomain = {
  id: string;
  label: CourseDomainLabel;
  /** 领域主色：课程设置里可配置，领域内课程按顺序自动分配近似色系 */
  color?: CourseColor;
  /** 领域内课程列顺序（课程河流中紧密排列） */
  courseIds: string[];
};

export type CourseDomainsConfig = {
  domains: CourseDomain[];
  /** 领域在整体视图中的左右顺序 */
  domainOrder: string[];
};

export const EMPTY_COURSE_DOMAINS_CONFIG: CourseDomainsConfig = {
  domains: [],
  domainOrder: [],
};

export function getCourseDomainLabel(
  label: CourseDomainLabel,
  language: 'zh' | 'en',
): string {
  const zh = (label.zh ?? '').trim();
  const en = (label.en ?? '').trim();
  return language === 'zh' ? zh || en : en || zh;
}

export function normalizeCourseDomainsConfig(raw: unknown): CourseDomainsConfig {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_COURSE_DOMAINS_CONFIG };
  const o = raw as Record<string, unknown>;
  const domainsIn = Array.isArray(o.domains) ? o.domains : [];
  const seenCourseIds = new Set<string>();
  const domains: CourseDomain[] = [];

  for (const item of domainsIn) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    const id = String(d.id ?? '').trim();
    if (!id) continue;
    const labelRaw = d.label;
    let zh = '';
    let en = '';
    let color: CourseColor | undefined;
    if (labelRaw && typeof labelRaw === 'object') {
      const l = labelRaw as Record<string, unknown>;
      zh = String(l.zh ?? '').trim();
      en = String(l.en ?? '').trim();
    }
    const c = String(d.color ?? '').trim();
    if (c) color = c as CourseColor;
    const courseIds: string[] = [];
    if (Array.isArray(d.courseIds)) {
      for (const cid of d.courseIds) {
        const s = String(cid ?? '').trim();
        if (!s || seenCourseIds.has(s)) continue;
        seenCourseIds.add(s);
        courseIds.push(s);
      }
    }
    domains.push({ id, label: { zh, en }, color, courseIds });
  }

  const domainIds = new Set(domains.map((d) => d.id));
  const orderIn = Array.isArray(o.domainOrder) ? o.domainOrder : [];
  const domainOrder: string[] = [];
  for (const x of orderIn) {
    const id = String(x ?? '').trim();
    if (id && domainIds.has(id) && !domainOrder.includes(id)) domainOrder.push(id);
  }
  for (const d of domains) {
    if (!domainOrder.includes(d.id)) domainOrder.push(d.id);
  }

  return { domains, domainOrder };
}

export function findDomainIdForCourse(
  config: CourseDomainsConfig,
  courseId: string,
): string | null {
  for (const d of config.domains) {
    if (d.courseIds.includes(courseId)) return d.id;
  }
  return null;
}

/** 将课程加入指定领域（null = 移出所有领域）；每门课最多属于一个领域 */
export function assignCourseToDomain(
  config: CourseDomainsConfig,
  courseId: string,
  domainId: string | null,
): CourseDomainsConfig {
  const next = normalizeCourseDomainsConfig(config);
  for (const d of next.domains) {
    d.courseIds = d.courseIds.filter((id) => id !== courseId);
  }
  if (domainId) {
    const domain = next.domains.find((d) => d.id === domainId);
    if (domain && !domain.courseIds.includes(courseId)) {
      domain.courseIds.push(courseId);
    }
  }
  return next;
}

export function removeCourseFromDomains(
  config: CourseDomainsConfig,
  courseId: string,
): CourseDomainsConfig {
  return assignCourseToDomain(config, courseId, null);
}

export function createCourseDomain(
  config: CourseDomainsConfig,
  label: CourseDomainLabel,
  color?: CourseColor,
): CourseDomainsConfig {
  const next = normalizeCourseDomainsConfig(config);
  const id = `domain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  next.domains.push({ id, label: { zh: label.zh.trim(), en: label.en.trim() }, color, courseIds: [] });
  next.domainOrder.push(id);
  return next;
}

export function deleteCourseDomain(
  config: CourseDomainsConfig,
  domainId: string,
): CourseDomainsConfig {
  const next = normalizeCourseDomainsConfig(config);
  next.domains = next.domains.filter((d) => d.id !== domainId);
  next.domainOrder = next.domainOrder.filter((id) => id !== domainId);
  return next;
}

export function updateCourseDomainLabel(
  config: CourseDomainsConfig,
  domainId: string,
  label: CourseDomainLabel,
): CourseDomainsConfig {
  const next = normalizeCourseDomainsConfig(config);
  const d = next.domains.find((x) => x.id === domainId);
  if (d) {
    d.label = { zh: label.zh.trim(), en: label.en.trim() };
  }
  return next;
}

export function updateCourseDomainColor(
  config: CourseDomainsConfig,
  domainId: string,
  color: CourseColor | undefined,
): CourseDomainsConfig {
  const next = normalizeCourseDomainsConfig(config);
  const d = next.domains.find((x) => x.id === domainId);
  if (d) d.color = color;
  return next;
}

export function reorderDomains(
  config: CourseDomainsConfig,
  domainOrder: string[],
): CourseDomainsConfig {
  const next = normalizeCourseDomainsConfig(config);
  const ids = new Set(next.domains.map((d) => d.id));
  const order = domainOrder.filter((id) => ids.has(id));
  for (const d of next.domains) {
    if (!order.includes(d.id)) order.push(d.id);
  }
  next.domainOrder = order;
  return next;
}

export function reorderCoursesInDomain(
  config: CourseDomainsConfig,
  domainId: string,
  courseIds: string[],
): CourseDomainsConfig {
  const next = normalizeCourseDomainsConfig(config);
  const d = next.domains.find((x) => x.id === domainId);
  if (!d) return next;
  const allowed = new Set(d.courseIds);
  d.courseIds = courseIds.filter((id) => allowed.has(id));
  for (const id of allowed) {
    if (!d.courseIds.includes(id)) d.courseIds.push(id);
  }
  return next;
}

export type RoadmapCourseColumn = {
  course: Course;
  displayKey: string;
};

export type RoadmapLayoutSegment =
  | {
      kind: 'domain';
      domainId: string;
      label: CourseDomainLabel;
      columns: RoadmapCourseColumn[];
    }
  | {
      kind: 'category';
      canonicalKey: string;
      displayKey: string;
      courses: Course[];
    };

export function countRoadmapLayoutColumns(segments: readonly RoadmapLayoutSegment[]): number {
  return segments.reduce(
    (n, s) => (s.kind === 'domain' ? n + s.columns.length : n + 1),
    0,
  );
}

export function getSubjectCategoryTextForLayout(
  subjectCategory: SubjectCategory | string | undefined,
  language: 'zh' | 'en',
): string {
  if (!subjectCategory) return '';
  if (typeof subjectCategory === 'object' && 'zh' in subjectCategory && 'en' in subjectCategory) {
    return language === 'zh' ? subjectCategory.zh : subjectCategory.en;
  }
  return String(subjectCategory);
}

export function getCategoryCanonicalKeyForLayout(
  subjectCategory: SubjectCategory | string | undefined,
): string {
  if (!subjectCategory) return '';
  if (typeof subjectCategory === 'object' && 'zh' in subjectCategory) {
    return subjectCategory.zh;
  }
  return String(subjectCategory);
}

/**
 * 构建课程河流整体视图列布局：先按领域（领域内每课一列），再按学科分类列（未归属领域的课程）
 */
export function buildRoadmapLayoutSegments(
  courses: readonly Course[],
  categoryOrder: readonly string[],
  domainsConfig: CourseDomainsConfig,
  language: 'zh' | 'en',
): RoadmapLayoutSegment[] {
  const config = normalizeCourseDomainsConfig(domainsConfig);
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const inDomain = new Set<string>();
  const segments: RoadmapLayoutSegment[] = [];

  for (const domainId of config.domainOrder) {
    const domain = config.domains.find((d) => d.id === domainId);
    if (!domain) continue;
    const columns: RoadmapCourseColumn[] = [];
    for (const cid of domain.courseIds) {
      const course = courseById.get(cid);
      if (!course) continue;
      inDomain.add(cid);
      columns.push({
        course,
        displayKey:
          getSubjectCategoryTextForLayout(course.subjectCategory, language) || course.name,
      });
    }
    if (columns.length > 0) {
      segments.push({
        kind: 'domain',
        domainId: domain.id,
        label: domain.label,
        columns,
      });
    }
  }

  const ungrouped = courses.filter((c) => !inDomain.has(c.id));
  const grouped: Record<string, { displayKey: string; courses: Course[] }> = {};
  ungrouped.forEach((c) => {
    const canonical = getCategoryCanonicalKeyForLayout(c.subjectCategory) || c.name;
    const displayKey =
      getSubjectCategoryTextForLayout(c.subjectCategory, language) || c.name;
    if (!grouped[canonical]) grouped[canonical] = { displayKey, courses: [] };
    grouped[canonical].courses.push(c);
    grouped[canonical].displayKey = displayKey;
  });

  const ordered = categoryOrder.filter((k) => grouped[k]);
  const keys = ordered.slice();
  Object.keys(grouped).forEach((k) => {
    if (!keys.includes(k)) keys.push(k);
  });

  for (const k of keys) {
    const entry = grouped[k];
    if (entry?.courses.length) {
      segments.push({
        kind: 'category',
        canonicalKey: k,
        displayKey: entry.displayKey,
        courses: entry.courses,
      });
    }
  }

  return segments;
}
