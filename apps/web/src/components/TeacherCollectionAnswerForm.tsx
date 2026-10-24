import type { TeacherCollectionBlock } from '@repo/shared';
import type { ReportTeachingDiagnosis } from '../types/classManagement';
import TeachingDiagnosisKissForm from './TeachingDiagnosisKissForm';

export default function TeacherCollectionAnswerForm({
  blocks,
  diagnosis,
  textAnswers,
  onDiagnosisChange,
  onTextAnswerChange,
  disabled,
  isZh,
}: {
  blocks: TeacherCollectionBlock[] | null | undefined;
  diagnosis: ReportTeachingDiagnosis;
  textAnswers: Record<string, string>;
  onDiagnosisChange: (next: ReportTeachingDiagnosis) => void;
  onTextAnswerChange: (blockId: string, value: string) => void;
  disabled?: boolean;
  isZh: boolean;
}) {
  const resolved: TeacherCollectionBlock[] =
    blocks && blocks.length > 0 ? blocks : [{ id: 'kiss', kind: 'kiss' }];

  return (
    <div className="space-y-6">
      {resolved.map((block, index) => (
        <div key={block.id} className={index > 0 ? 'border-t border-slate-100 pt-6' : ''}>
          {block.kind === 'kiss' ? (
            <TeachingDiagnosisKissForm
              value={diagnosis}
              onChange={onDiagnosisChange}
              disabled={disabled}
              isZh={isZh}
            />
          ) : (
            <div className="space-y-1">
              <label className="block text-sm font-medium text-slate-800">{block.label}</label>
              <textarea
                value={textAnswers[block.id] ?? ''}
                onChange={(event) => onTextAnswerChange(block.id, event.target.value)}
                disabled={disabled}
                rows={6}
                className="min-h-[7rem] w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-600"
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
