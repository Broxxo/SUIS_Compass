/** 与岗位安排、评价报告学科 subject_key 一致：基于课程 id 或名称规范化 */
export function staffingSubjectKeyFromCourse(courseId: string, courseName: string): string {
  const base = (courseId || courseName || '').trim();
  const normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return normalized || 'subject';
}
