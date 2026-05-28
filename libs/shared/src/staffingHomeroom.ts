/** 岗位安排表「班主任」列对应的 subject_key（与学业报告工作台班主任哨兵一致） */
export const STAFFING_HOMEROOM_SUBJECT_KEY = '__homeroom__';

export function staffingHomeroomSubjectName(isZh: boolean): string {
  return isZh ? '班主任' : 'Homeroom';
}
