import type { ReportTeachingDiagnosis } from '../types/classManagement';

export const TEACHING_DIAGNOSIS_KISS_FIELDS: Array<{
  key: keyof ReportTeachingDiagnosis;
  labelZh: string;
  labelEn: string;
  hintZh: string;
  hintEn: string;
}> = [
  { key: 'keep', labelZh: 'Keep · 优势，继续保持', labelEn: 'Keep — strengths to maintain', hintZh: '本阶段教学中值得延续的做法', hintEn: 'Practices worth continuing' },
  { key: 'improve', labelZh: 'Improve · 不足，需要优化', labelEn: 'Improve — gaps to refine', hintZh: '需要调整或加强的方面', hintEn: 'Areas to adjust or strengthen' },
  { key: 'stop', labelZh: 'Stop · 无效，及时停止', labelEn: 'Stop — ineffective habits', hintZh: '应减少或停止的做法', hintEn: 'Practices to reduce or stop' },
  { key: 'start', labelZh: 'Start · 新的行动', labelEn: 'Start — new actions', hintZh: '下一阶段准备尝试的行动', hintEn: 'Actions to try next' },
];

export default function TeachingDiagnosisKissForm({
  value,
  onChange,
  disabled,
  isZh,
}: {
  value: ReportTeachingDiagnosis;
  onChange: (next: ReportTeachingDiagnosis) => void;
  disabled?: boolean;
  isZh: boolean;
}) {
  return (
    <div className="space-y-4">
      {TEACHING_DIAGNOSIS_KISS_FIELDS.map((field) => (
        <div key={field.key} className="space-y-1">
          <label className="block text-sm font-medium text-slate-800">
            {isZh ? field.labelZh : field.labelEn}
          </label>
          <p className="text-[11px] text-slate-500">{isZh ? field.hintZh : field.hintEn}</p>
          <textarea
            value={value[field.key]}
            onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
            disabled={disabled}
            rows={4}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-y min-h-[5rem] disabled:bg-slate-50 disabled:text-slate-600"
          />
        </div>
      ))}
    </div>
  );
}
