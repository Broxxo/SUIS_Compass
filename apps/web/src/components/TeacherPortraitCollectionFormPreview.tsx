import type { TeacherCollectionBlock } from '@repo/shared';
import type { ReportTeachingDiagnosis } from '../types/classManagement';
import TeacherCollectionAnswerForm from './TeacherCollectionAnswerForm';

const EMPTY_KISS: ReportTeachingDiagnosis = { keep: '', improve: '', stop: '', start: '' };

export default function TeacherPortraitCollectionFormPreview({
  blocks,
  isZh,
}: {
  blocks: TeacherCollectionBlock[] | null | undefined;
  isZh: boolean;
}) {
  return (
    <TeacherCollectionAnswerForm
      blocks={blocks}
      diagnosis={EMPTY_KISS}
      textAnswers={{}}
      onDiagnosisChange={() => {}}
      onTextAnswerChange={() => {}}
      disabled
      isZh={isZh}
    />
  );
}
