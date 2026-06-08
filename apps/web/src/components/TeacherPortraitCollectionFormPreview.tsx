import {
  TEACHER_PORTRAIT_COLLECTION_TYPES,
  teacherPortraitCollectionTypeLabel,
  type TeacherPortraitCollectionType,
} from '@repo/shared';
import type { ReportTeachingDiagnosis } from '../types/classManagement';
import TeachingDiagnosisKissForm from './TeachingDiagnosisKissForm';

const EMPTY_KISS: ReportTeachingDiagnosis = { keep: '', improve: '', stop: '', start: '' };

export default function TeacherPortraitCollectionFormPreview({
  collectionType,
  isZh,
}: {
  collectionType: TeacherPortraitCollectionType;
  isZh: boolean;
}) {
  if (collectionType === 'teaching-diagnosis-kiss') {
    return (
      <TeachingDiagnosisKissForm
        value={EMPTY_KISS}
        onChange={() => {}}
        disabled
        isZh={isZh}
      />
    );
  }

  const label = teacherPortraitCollectionTypeLabel(collectionType, isZh);
  const known = collectionType in TEACHER_PORTRAIT_COLLECTION_TYPES;
  return (
    <p className="text-sm text-slate-500">
      {known
        ? isZh
          ? `「${label}」预览尚未配置。`
          : `Preview for “${label}” is not configured yet.`
        : isZh
          ? '未知模版类型。'
          : 'Unknown template type.'}
    </p>
  );
}
