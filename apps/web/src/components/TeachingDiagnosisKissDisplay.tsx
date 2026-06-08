import type { ReportTeachingDiagnosis } from '../types/classManagement';
import { TEACHING_DIAGNOSIS_KISS_FIELDS } from './TeachingDiagnosisKissForm';

export default function TeachingDiagnosisKissDisplay({
  value,
  isZh,
}: {
  value: ReportTeachingDiagnosis;
  isZh: boolean;
}) {
  return (
    <div className="space-y-4">
      {TEACHING_DIAGNOSIS_KISS_FIELDS.map((field) => {
        const text = value[field.key]?.trim();
        return (
          <div key={field.key} className="space-y-1">
            <h4 className="text-sm font-medium text-slate-800">
              {isZh ? field.labelZh : field.labelEn}
            </h4>
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
              {text || (
                <span className="text-slate-400">{isZh ? '未填写' : 'Not filled'}</span>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}
