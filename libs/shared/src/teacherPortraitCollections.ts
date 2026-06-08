export const TEACHER_PORTRAIT_COLLECTION_TYPES = {
  'teaching-diagnosis-kiss': {
    id: 'teaching-diagnosis-kiss',
    labelZh: '阶段教学诊断',
    labelEn: 'Phase teaching diagnosis (KISS)',
  },
} as const;

export type TeacherPortraitCollectionType = keyof typeof TEACHER_PORTRAIT_COLLECTION_TYPES;

export function teacherPortraitCollectionTypeLabel(
  type: TeacherPortraitCollectionType,
  isZh: boolean,
): string {
  const def = TEACHER_PORTRAIT_COLLECTION_TYPES[type];
  return isZh ? def.labelZh : def.labelEn;
}
