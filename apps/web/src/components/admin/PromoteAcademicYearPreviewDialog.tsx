import { useMemo, useState } from 'react';
import type { AcademicYearPromotionPreview } from '../../types/classManagement';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { SegmentTabButton } from '../ui/segment-tab-button';

type PreviewTab = 'overview' | 'classes' | 'staffing' | 'functional' | 'unchanged';

type PromoteAcademicYearPreviewDialogProps = {
  isZh: boolean;
  open: boolean;
  loading: boolean;
  submitting: boolean;
  preview: AcademicYearPromotionPreview | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

function PreviewTable({
  headers,
  rows,
  emptyText,
}: {
  headers: string[];
  rows: string[][];
  emptyText: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500 py-2">{emptyText}</p>;
  }
  return (
    <div className="overflow-x-auto max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 sticky top-0">
          <tr>
            {headers.map((h) => (
              <th key={h} className="py-2 px-3 text-left text-xs font-medium text-slate-600 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-100">
              {row.map((cell, j) => (
                <td key={j} className="py-2 px-3 text-slate-800 whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PromoteAcademicYearPreviewDialog({
  isZh,
  open,
  loading,
  submitting,
  preview,
  onOpenChange,
  onConfirm,
}: PromoteAcademicYearPreviewDialogProps) {
  const [tab, setTab] = useState<PreviewTab>('overview');

  const tabs = useMemo(
    () =>
      [
        { id: 'overview' as const, label: isZh ? '概览' : 'Overview' },
        { id: 'classes' as const, label: isZh ? '班级与学籍' : 'Classes' },
        { id: 'staffing' as const, label: isZh ? '岗位安排' : 'Staffing' },
        { id: 'functional' as const, label: isZh ? '职能岗位' : 'Functional roles' },
        { id: 'unchanged' as const, label: isZh ? '不变项' : 'Unchanged' },
      ],
    [isZh],
  );

  const canConfirm = !!preview?.canExecute && !loading && !submitting;

  const blockMessage =
    preview?.blockReason === 'TARGET_YEAR_EXISTS'
      ? (isZh ? '目标学年已存在，无法重复升学年。' : 'Target academic year already exists.')
      : preview?.blockReason === 'SOURCE_YEAR_NOT_FOUND'
        ? (isZh ? '源学年不存在。' : 'Source academic year not found.')
        : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isZh ? '升学年预览' : 'Promotion preview'}</DialogTitle>
          <DialogDescription>
            {loading
              ? (isZh ? '正在计算变更…' : 'Computing changes…')
              : preview
                ? isZh
                  ? `由「${preview.sourceYearName}」升入「${preview.targetYearName}」。请逐项核对后再确认执行。`
                  : `Promote from "${preview.sourceYearName}" to "${preview.targetYearName}". Review before confirming.`
                : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 shrink-0">
          {tabs.map((t) => (
            <SegmentTabButton key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </SegmentTabButton>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 py-1">
          {loading && (
            <p className="text-sm text-slate-500">{isZh ? '加载预览中…' : 'Loading preview…'}</p>
          )}

          {!loading && preview && tab === 'overview' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                  <div className="text-xs text-slate-500">{isZh ? '升班班级' : 'Promoted classes'}</div>
                  <div className="font-semibold text-slate-900">{preview.summary.classesPromoted}</div>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                  <div className="text-xs text-slate-500">{isZh ? '升班学生' : 'Promoted students'}</div>
                  <div className="font-semibold text-slate-900">{preview.summary.studentsPromoted}</div>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                  <div className="text-xs text-amber-800">{isZh ? '毕业归档班' : 'Graduating classes'}</div>
                  <div className="font-semibold text-amber-900">{preview.summary.classesGraduated}</div>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                  <div className="text-xs text-amber-800">{isZh ? '毕业生' : 'Graduates'}</div>
                  <div className="font-semibold text-amber-900">{preview.summary.studentsGraduated}</div>
                </div>
              </div>
              <ul className="text-sm text-slate-700 space-y-1 list-disc pl-5">
                <li>
                  {isZh
                    ? `新建学年「${preview.targetYearName}」并设为系统默认学年`
                    : `Create "${preview.targetYearName}" and set as system default`}
                </li>
                <li>
                  {isZh
                    ? `复制任课岗位 ${preview.summary.subjectAssignmentsCopied} 条`
                    : `Copy ${preview.summary.subjectAssignmentsCopied} subject assignments`}
                </li>
                <li>
                  {isZh
                    ? `复制教学学科组成员 ${preview.summary.subjectGroupMembersCopied} 人`
                    : `Copy ${preview.summary.subjectGroupMembersCopied} subject group members`}
                </li>
              </ul>
              {preview.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
                  {preview.warnings.map((w) => (
                    <p key={w} className="text-sm text-amber-900">
                      {w}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {!loading && preview && tab === 'classes' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '升班班级' : 'Classes promoted'}</h4>
                <PreviewTable
                  headers={
                    isZh
                      ? ['原班级', '新班级', '学生数', '班主任']
                      : ['From', 'To', 'Students', 'Homeroom']
                  }
                  rows={preview.classes.promote.map((r) => [
                    `${r.sourceName} (G${r.sourceGrade})`,
                    `${r.targetName} (G${r.targetGrade})`,
                    String(r.studentCount),
                    r.homeroomTeacherName ?? '—',
                  ])}
                  emptyText={isZh ? '无升班班级' : 'No classes to promote'}
                />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-amber-900 mb-2">{isZh ? '毕业归档班级' : 'Graduating classes'}</h4>
                <PreviewTable
                  headers={
                    isZh
                      ? ['班级', '归档标签', '学生数', '班主任（将释放）']
                      : ['Class', 'Archive', 'Students', 'Homeroom (released)']
                  }
                  rows={preview.classes.graduate.map((r) => [
                    `${r.className} (G${r.grade})`,
                    r.archiveLabel,
                    String(r.studentCount),
                    r.homeroomTeacherName ?? '—',
                  ])}
                  emptyText={isZh ? '无毕业班' : 'No graduating classes'}
                />
              </div>
            </div>
          )}

          {!loading && preview && tab === 'staffing' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-800 mb-2">
                  {isZh ? '新学年复制的任课岗位' : 'Subject assignments copied to new year'}
                </h4>
                <PreviewTable
                  headers={isZh ? ['原班', '新班', '学科', '教师'] : ['From', 'To', 'Subject', 'Teacher']}
                  rows={preview.staffing.subjectCopies.map((r) => [
                    r.sourceClassName,
                    r.targetClassName,
                    r.subjectName,
                    r.teacherName,
                  ])}
                  emptyText={isZh ? '无任课岗位复制' : 'No subject assignments to copy'}
                />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-amber-900 mb-2">
                  {isZh ? '毕业班释放的岗位' : 'Staffing released from graduating classes'}
                </h4>
                <PreviewTable
                  headers={
                    isZh
                      ? ['班级', '归档标签', '班主任', '任课条数']
                      : ['Class', 'Archive', 'Homeroom', 'Subject slots']
                  }
                  rows={preview.staffing.graduateStaffingReleased.map((r) => [
                    r.className,
                    r.archiveLabel,
                    r.homeroomTeacherName ?? '—',
                    String(r.subjectAssignmentCount),
                  ])}
                  emptyText={isZh ? '无毕业班岗位释放' : 'No staffing to release'}
                />
              </div>
              <p className="text-xs text-slate-500">
                {isZh
                  ? '升班班级的班主任将随班复制至新学年对应班级。'
                  : 'Homeroom teachers for promoted classes are copied to the new year.'}
              </p>
            </div>
          )}

          {!loading && preview && tab === 'functional' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '年级组长（随年级上升）' : 'Grade heads (promoted)'}</h4>
                <PreviewTable
                  headers={isZh ? ['原年级', '新年级', '教师'] : ['From', 'To', 'Teacher']}
                  rows={preview.functionalRoles.gradeHeadPromote.map((r) => [
                    r.fromScopeLabel,
                    r.toScopeLabel,
                    r.teacherName,
                  ])}
                  emptyText={isZh ? '无年级组长升任' : 'No grade heads to promote'}
                />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-amber-900 mb-2">{isZh ? '毕业年级组长（释放）' : 'Grade heads released'}</h4>
                <PreviewTable
                  headers={isZh ? ['年级', '教师'] : ['Grade', 'Teacher']}
                  rows={preview.functionalRoles.gradeHeadRelease.map((r) => [r.scopeLabel, r.teacherName])}
                  emptyText={isZh ? '无毕业年级组长' : 'No grade heads to release'}
                />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-800 mb-2">{isZh ? '学科组长（原样复制）' : 'Subject group heads (copied)'}</h4>
                <PreviewTable
                  headers={isZh ? ['学科组', '教师'] : ['Group', 'Teacher']}
                  rows={preview.functionalRoles.subjectGroupHeadCopy.map((r) => [r.scopeLabel, r.teacherName])}
                  emptyText={isZh ? '无学科组长' : 'No subject group heads'}
                />
              </div>
              <p className="text-sm text-slate-600">
                {isZh
                  ? `教学学科组成员：${preview.functionalRoles.subjectGroupMembersCopied} 人将复制至新学年。`
                  : `Teaching subject group members: ${preview.functionalRoles.subjectGroupMembersCopied} copied.`}
              </p>
            </div>
          )}

          {!loading && preview && tab === 'unchanged' && (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                {isZh ? '以下内容不会随本次升学年改变：' : 'The following will not change:'}
              </p>
              <ul className="text-sm text-slate-700 space-y-1.5 list-disc pl-5">
                {preview.unchanged.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-col sm:flex-row gap-2 sm:gap-0">
          {!loading && blockMessage && (
            <p className="text-sm text-red-600 w-full sm:mr-auto sm:mb-0 mb-1">{blockMessage}</p>
          )}
          <div className="flex gap-2 w-full sm:w-auto justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {isZh ? '取消' : 'Cancel'}
          </Button>
          <Button onClick={onConfirm} disabled={!canConfirm}>
            {submitting
              ? (isZh ? '升学年中…' : 'Promoting…')
              : (isZh ? '确认升学年' : 'Confirm promotion')}
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
