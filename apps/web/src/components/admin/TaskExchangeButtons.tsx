import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { downloadAcademicReportWorkbook, parseAcademicReportWorkbook } from '../../lib/academicReportExcel';
import { downloadTeacherCollectionWorkbook, parseTeacherCollectionWorkbook } from '../../lib/teacherCollectionExcel';
import { Button } from '../ui/button';

function useFileInput(onFile: (file: File) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  return {
    inputRef,
    open: () => inputRef.current?.click(),
    input: (
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
    ),
  };
}

export function AcademicReportExchangeButtons({
  templateId,
  title,
  isZh,
  onImported,
}: {
  templateId: string;
  title: string;
  isZh: boolean;
  onImported?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const file = useFileInput((picked) => void importFile(picked));

  const exportFile = async () => {
    setBusy(true);
    try {
      downloadAcademicReportWorkbook(await api.exportAcademicReport(templateId));
    } catch (error: unknown) {
      alert((error as Error)?.message || (isZh ? '导出失败' : 'Export failed'));
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (picked: File) => {
    setBusy(true);
    try {
      const parsed = parseAcademicReportWorkbook(await picked.arrayBuffer());
      if (!parsed.payload || parsed.errors.length > 0) {
        alert((isZh ? '导入失败：\n' : 'Import failed:\n') + parsed.errors.join('\n'));
        return;
      }
      const fileTitle = parsed.payload.meta.templateTitle.trim();
      const currentTitle = title.trim();
      if (fileTitle && currentTitle && fileTitle !== currentTitle) {
        const ok = window.confirm(
          isZh
            ? `文件中的报告是「${fileTitle}」，将写入当前这份「${currentTitle}」。文件里有的学生会被更新，文件里没有的学生保持不变。继续？`
            : `The file is "${fileTitle}" and will update "${currentTitle}". Students absent from the file stay unchanged. Continue?`,
        );
        if (!ok) return;
      }
      const result = await api.importAcademicReport(templateId, parsed.payload);
      onImported?.();
      const notices = result.warnings.slice(0, 8).join('\n');
      alert(
        isZh
          ? `已导入 ${result.importedStudents} 名学生。${notices ? `\n${notices}` : ''}`
          : `Imported ${result.importedStudents} students.${notices ? `\n${notices}` : ''}`,
      );
    } catch (error: unknown) {
      alert((error as Error)?.message || (isZh ? '导入失败' : 'Import failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {file.input}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void exportFile()}>
        {isZh ? '导出' : 'Export'}
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={file.open}>
        {isZh ? '导入' : 'Import'}
      </Button>
    </>
  );
}

export function TeacherCollectionExchangeButtons({
  templateId,
  title,
  isZh,
  onImported,
}: {
  templateId: string;
  title: string;
  isZh: boolean;
  onImported?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const file = useFileInput((picked) => void importFile(picked));

  const exportFile = async () => {
    setBusy(true);
    try {
      downloadTeacherCollectionWorkbook(await api.exportAdminTeacherPortraitCollection(templateId));
    } catch (error: unknown) {
      alert((error as Error)?.message || (isZh ? '导出失败' : 'Export failed'));
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (picked: File) => {
    setBusy(true);
    try {
      const parsed = parseTeacherCollectionWorkbook(await picked.arrayBuffer());
      if (!parsed.payload || parsed.errors.length > 0) {
        alert((isZh ? '导入失败：\n' : 'Import failed:\n') + parsed.errors.join('\n'));
        return;
      }
      const fileTitle = parsed.payload.meta.title.trim();
      const currentTitle = title.trim();
      if (fileTitle && currentTitle && fileTitle !== currentTitle) {
        const ok = window.confirm(
          isZh
            ? `文件中的任务是「${fileTitle}」，将写入当前这份「${currentTitle}」。文件里有的教师会被更新，文件里没有的教师保持不变。继续？`
            : `The file is "${fileTitle}" and will update "${currentTitle}". Teachers absent from the file stay unchanged. Continue?`,
        );
        if (!ok) return;
      }
      const result = await api.importAdminTeacherPortraitCollection(templateId, parsed.payload);
      onImported?.();
      const notices = result.warnings.slice(0, 8).join('\n');
      alert(
        isZh
          ? `已导入 ${result.importedTeachers} 位教师。${notices ? `\n${notices}` : ''}`
          : `Imported ${result.importedTeachers} teachers.${notices ? `\n${notices}` : ''}`,
      );
    } catch (error: unknown) {
      alert((error as Error)?.message || (isZh ? '导入失败' : 'Import failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {file.input}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void exportFile()}>
        {isZh ? '导出' : 'Export'}
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={file.open}>
        {isZh ? '导入' : 'Import'}
      </Button>
    </>
  );
}
