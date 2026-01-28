import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Course, Semester, Unit } from '../types';
import * as XLSX from 'xlsx';

interface BulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: Course;
  semester: Semester;
  onImportUnits: (units: Omit<Unit, 'id' | 'order'>[]) => void;
}

export default function BulkImportDialog({ 
  open, 
  onOpenChange, 
  course, 
  semester,
  onImportUnits 
}: BulkImportDialogProps) {
  const [_file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [showMismatchWarning, setShowMismatchWarning] = useState(false);
  const [parsedUnits, setParsedUnits] = useState<Omit<Unit, 'id' | 'order'>[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 验证文件名格式：{courseName}+G{grade}+S{semester}
  // 例如：Math+G7+S1 (七年级上学期数学)
  const validateFileName = (fileName: string, grade: number, courseName: string, semester: 'Semester 1' | 'Semester 2'): boolean => {
    // 移除文件扩展名
    const nameWithoutExt = fileName.replace(/\.(xlsx|xls)$/i, '').trim();
    
    // 学期标识：Semester 1 -> S1, Semester 2 -> S2
    const semesterCode = semester === 'Semester 1' ? 'S1' : 'S2';
    
    // 构建期望的文件名格式：{courseName}+G{grade}+S{semester}
    // 例如：Math+G7+S1, Chinese+G7+S1, Math_IG0580+G7+S2
    const expectedPattern = `${courseName}+G${grade}+${semesterCode}`;
    
    // 检查是否匹配（支持大小写不敏感，并处理可能的空格）
    const normalizedFileName = nameWithoutExt.replace(/\s+/g, '').toLowerCase();
    const normalizedExpected = expectedPattern.replace(/\s+/g, '').toLowerCase();
    
    return normalizedFileName === normalizedExpected;
  };

  // 处理文件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setFileName(selectedFile.name);
    setValidationError('');
    setShowMismatchWarning(false);
    setParsedUnits([]);

    // 验证文件名：需要包含课程名+年级+学期
    const isValid = validateFileName(selectedFile.name, semester.grade, course.name, semester.semester);
    
    if (!isValid) {
      setShowMismatchWarning(true);
      // 仍然解析文件，但显示警告
      parseExcelFile(selectedFile);
    } else {
      parseExcelFile(selectedFile);
    }
  };

  // 解析Excel文件
  const parseExcelFile = (file: File) => {
    setIsValidating(true);
    setValidationError('');

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // 读取第一个工作表
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // 转换为JSON数组
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        
        if (jsonData.length < 2) {
          setValidationError('Excel文件至少需要包含标题行和一行数据');
          setIsValidating(false);
          return;
        }

        // 第一行是标题
        const headers = jsonData[0].map((h: any) => String(h).trim().toLowerCase());
        
        // 查找列索引
        // unitIndex not used, removed
        const titleIndex = headers.findIndex(h => h.includes('title'));
        const focusIndex = headers.findIndex(h => h.includes('focus'));
        const keyConceptsIndex = headers.findIndex(h => h.includes('keyconcept') || h.includes('key concept'));
        const weekIndex = headers.findIndex(h => h.includes('week'));
        const periodsIndex = headers.findIndex(h => h.includes('period'));

        if (titleIndex === -1 || focusIndex === -1 || weekIndex === -1 || periodsIndex === -1) {
          setValidationError('Excel文件缺少必需的列：Title, Focus, Week, Periods');
          setIsValidating(false);
          return;
        }

        // 解析数据行
        const units: Omit<Unit, 'id' | 'order'>[] = [];
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length === 0) continue;

          const title = String(row[titleIndex] || '').trim();
          const focus = String(row[focusIndex] || '').trim();
          const week = String(row[weekIndex] || '').trim();
          const periods = row[periodsIndex];

          if (!title || !focus || !week || !periods) {
            continue; // 跳过空行
          }

          // 解析KeyConcepts（用+分隔）
          let keyConcepts: string[] = [];
          if (keyConceptsIndex !== -1 && row[keyConceptsIndex]) {
            const conceptsStr = String(row[keyConceptsIndex]).trim();
            keyConcepts = conceptsStr
              .split('+')
              .map(c => c.trim())
              .filter(c => c.length > 0);
          }

          // 验证周次格式
          const weekPattern = /^\d{1,2}(-\d{1,2})?$/;
          if (!weekPattern.test(week)) {
            setValidationError(`第${i + 1}行的周次格式不正确：${week}`);
            setIsValidating(false);
            return;
          }

          // 验证课时
          const periodsNum = Number(periods);
          if (isNaN(periodsNum) || periodsNum <= 0) {
            setValidationError(`第${i + 1}行的课时格式不正确：${periods}`);
            setIsValidating(false);
            return;
          }

          units.push({
            title,
            focus,
            keyConcepts,
            week,
            periods: periodsNum,
          });
        }

        if (units.length === 0) {
          setValidationError('Excel文件中没有有效的单元数据');
          setIsValidating(false);
          return;
        }

        setParsedUnits(units);
        setIsValidating(false);
      } catch (error) {
        console.error('解析Excel文件失败:', error);
        setValidationError('解析Excel文件失败，请检查文件格式是否正确');
        setIsValidating(false);
      }
    };

    reader.onerror = () => {
      setValidationError('读取文件失败');
      setIsValidating(false);
    };

    reader.readAsArrayBuffer(file);
  };

  // 处理导入
  const handleImport = () => {
    if (parsedUnits.length === 0) {
      setValidationError('没有可导入的单元数据');
      return;
    }

    onImportUnits(parsedUnits);
    handleClose();
  };

  // 关闭对话框
  const handleClose = () => {
    setFile(null);
    setFileName('');
    setValidationError('');
    setShowMismatchWarning(false);
    setParsedUnits([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onOpenChange(false);
  };

  // 继续导入（即使文件名不匹配）
  const handleContinueImport = () => {
    setShowMismatchWarning(false);
    if (parsedUnits.length > 0) {
      handleImport();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>批量导入单元</DialogTitle>
          <DialogDescription>
            上传Excel文件批量导入单元数据
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* 文件名格式说明 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm text-blue-800">
              <strong>文件名格式要求：</strong> {course.name}+G{semester.grade}+S{semester.semester === 'Semester 1' ? '1' : '2'}
            </p>
            <p className="text-xs text-blue-600 mt-1">
              例如：{course.name}+G{semester.grade}+S{semester.semester === 'Semester 1' ? '1' : '2'}.xlsx
            </p>
            <p className="text-xs text-blue-600 mt-1">
              （必须包含：课程名 + 年级 + 学期，S1表示上学期，S2表示下学期）
            </p>
          </div>

          {/* Excel格式说明 */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-sm font-medium text-gray-700 mb-2">Excel文件格式：</p>
            <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
              <li>第一行：Unit, Title, Focus, KeyConcepts, Week, Periods</li>
              <li>KeyConcepts用+分隔多个概念（例如：形式 Form+逻辑 Logic）</li>
              <li>Week格式：单个数字（如：1）或范围（如：1-3）</li>
              <li>Periods为数字，表示课时数</li>
            </ul>
          </div>

          {/* 文件选择 */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              选择Excel文件
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileSelect}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {fileName && (
              <p className="text-sm text-gray-600 mt-1">已选择：{fileName}</p>
            )}
          </div>

          {/* 文件名不匹配警告 */}
          {showMismatchWarning && (
            <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4">
              <p className="text-sm font-medium text-yellow-800 mb-2">
                ⚠️ 文件名不匹配
              </p>
              <p className="text-xs text-yellow-700 mb-3">
                文件名应为：<strong>{course.name}+G{semester.grade}+S{semester.semester === 'Semester 1' ? '1' : '2'}</strong>
                <br />
                当前文件名：<strong>{fileName}</strong>
              </p>
              <p className="text-xs text-yellow-700 mb-2">
                <strong>要求：</strong>
              </p>
              <ul className="text-xs text-yellow-700 mb-3 list-disc list-inside space-y-1">
                <li>课程名：{course.name}</li>
                <li>年级：G{semester.grade}</li>
                <li>学期：S{semester.semester === 'Semester 1' ? '1' : '2'} ({semester.semester === 'Semester 1' ? '上学期' : '下学期'})</li>
              </ul>
              <p className="text-xs text-yellow-700 mb-3">
                是否仍要继续导入此文件？
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={handleContinueImport}
                  size="sm"
                  className="bg-yellow-600 hover:bg-yellow-700"
                >
                  继续导入
                </Button>
                <Button
                  onClick={() => {
                    setShowMismatchWarning(false);
                    setFile(null);
                    setFileName('');
                    setParsedUnits([]);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                  variant="outline"
                  size="sm"
                >
                  取消
                </Button>
              </div>
            </div>
          )}

          {/* 验证错误 */}
          {validationError && (
            <div className="bg-red-50 border border-red-300 rounded-lg p-3">
              <p className="text-sm text-red-800">{validationError}</p>
            </div>
          )}

          {/* 解析成功信息 */}
          {parsedUnits.length > 0 && !showMismatchWarning && (
            <div className="bg-green-50 border border-green-300 rounded-lg p-3">
              <p className="text-sm text-green-800">
                ✓ 成功解析 {parsedUnits.length} 个单元
              </p>
            </div>
          )}

          {/* 解析中 */}
          {isValidating && (
            <div className="text-center py-4">
              <p className="text-sm text-gray-600">正在解析Excel文件...</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            取消
          </Button>
          <Button
            onClick={handleImport}
            disabled={parsedUnits.length === 0 || isValidating || showMismatchWarning}
          >
            导入 {parsedUnits.length > 0 ? `(${parsedUnits.length}个单元)` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
