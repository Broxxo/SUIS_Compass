import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Course, Semester, Unit } from '../types';
import { Loader2, Sparkles, CheckCircle2, AlertCircle, Edit2, Trash2, Upload, X } from 'lucide-react';
import { AI_MODELS, getSavedModelId, saveModelId, getModelCode } from '../lib/aiModels';
import { getSubjectCategoryText } from '../lib/utils';
import { useLanguage } from '../contexts/LanguageContext';
import { GRADE_LABELS, SEMESTER_LABELS } from '../lib/constants';
import { getKeyConcepts } from '../lib/utils';
import { loadSemesterDataSync } from '../lib/storage';
import { extractTextFromPDF } from '../lib/pdfParser';
import { getApiUrl, getAuthHeaders } from '../lib/api';

/** 预计生成总时长（秒），用于进度估算 */
const ESTIMATED_DURATION_SEC = 75;
/** 前 N 秒视为「搜索」阶段 */
const SEARCH_PHASE_SEC = 3;

interface AIGenerateUnitsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: Course;
  semester: Semester;
  onConfirm: (units: Omit<Unit, 'id' | 'order'>[]) => void;
}


interface GeneratedUnit {
  title: string;
  focus: string;
  keyConcepts: string[];
  week: string;
  periods: number;
}

export default function AIGenerateUnitsDialog({
  open,
  onOpenChange,
  course,
  semester,
  onConfirm,
}: AIGenerateUnitsDialogProps) {
  const { language } = useLanguage();
  const [textbookInfo, setTextbookInfo] = useState('');
  const [extraPrompt, setExtraPrompt] = useState('');
  const [totalWeeks, setTotalWeeks] = useState(20);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedUnits, setGeneratedUnits] = useState<GeneratedUnit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingUnit, setEditingUnit] = useState<GeneratedUnit | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string>(getSavedModelId());
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // 教材上传相关状态
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFileContent, setUploadedFileContent] = useState<string>('');
  const [isReadingFile, setIsReadingFile] = useState(false);
  
  // 获取该学期的周课时数：优先使用 SemesterData.weeklyPeriods，否则使用 course.weeklyPeriods
  const [weeklyPeriods, setWeeklyPeriods] = useState<number>(course.weeklyPeriods || 2);
  
  // 当对话框打开时，自动填充教材信息，并加载学期级别的周课时数
  useEffect(() => {
    if (open && course && semester) {
      const category = getSubjectCategoryText(course.subjectCategory, language) || course.name;
      const version = course.textbookVersion || '人教版';
      const gradeLabel = GRADE_LABELS[semester.grade];
      const semesterLabel = SEMESTER_LABELS[semester.semester];
      const defaultTextbookInfo = `${category}-${version}-${gradeLabel}${semesterLabel}`;
      setTextbookInfo(defaultTextbookInfo);
      
      // 加载学期级别的周课时数
      const semesterData = loadSemesterDataSync(course.id, semester.grade, semester.semester);
      setWeeklyPeriods(semesterData?.weeklyPeriods ?? course.weeklyPeriods ?? 2);
      
      // 重置上传状态与补充提示
      setUploadedFile(null);
      setUploadedFileContent('');
      setExtraPrompt('');
    }
  }, [open, course, semester, language]);
  
  // 根据周次计算课时数的辅助函数
  const calculatePeriodsFromWeek = (week: string): number => {
    if (week.includes('-')) {
      const [start, end] = week.split('-').map(Number);
      const weekCount = end - start + 1;
      return weekCount * weeklyPeriods;
    } else {
      return weeklyPeriods;
    }
  };

  // 验证周次格式
  const validateWeekFormat = (week: string): boolean => {
    const trimmed = week.trim();
    if (!trimmed) return false;
    
    if (/^\d{1,2}$/.test(trimmed)) return true;
    
    if (/^\d{1,2}-\d{1,2}$/.test(trimmed)) {
      const [start, end] = trimmed.split('-').map(Number);
      return start < end && start > 0 && end > 0;
    }
    
    return false;
  };

  // 验证关键概念是否在清单中
  const validateKeyConcepts = (concepts: string[]): { valid: boolean; invalid: string[] } => {
    const keyConcepts = getKeyConcepts();
    const invalid = concepts.filter(c => !keyConcepts.includes(c));
    return { valid: invalid.length === 0, invalid };
  };

  // 从AI响应中提取JSON
  const extractJSON = (text: string): any[] | null => {
    // 清理文本：移除前后空白
    const cleaned = text.trim();
    
    // 方法1: 尝试直接解析整个文本
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        // Successfully parsed JSON directly
        return parsed;
      }
    } catch (e) {
      // 继续尝试其他方法
    }

    // 方法2: 尝试从markdown代码块中提取（支持多行）
    // 匹配 ```json ... ``` 或 ``` ... ```
    const codeBlockPatterns = [
      /```(?:json)?\s*\n?(\[[\s\S]*?\])\s*\n?```/,
      /```(?:json)?\s*(\[[\s\S]*?\])/,
    ];
    
    for (const pattern of codeBlockPatterns) {
      const match = cleaned.match(pattern);
      if (match && match[1]) {
        try {
          const parsed = JSON.parse(match[1].trim());
          if (Array.isArray(parsed)) {
            // Successfully parsed JSON from code block
            return parsed;
          }
        } catch (e) {
          console.warn('Failed to parse JSON from code block:', e);
        }
      }
    }

    // 方法3: 查找最外层的JSON数组（处理嵌套情况）
    // 从后往前查找，找到第一个完整的数组
    let bracketCount = 0;
    let startIndex = -1;
    
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === '[') {
        if (bracketCount === 0) startIndex = i;
        bracketCount++;
      } else if (cleaned[i] === ']') {
        bracketCount--;
        if (bracketCount === 0 && startIndex !== -1) {
          // 找到了一个完整的数组
          const jsonStr = cleaned.substring(startIndex, i + 1);
          try {
            const parsed = JSON.parse(jsonStr);
            if (Array.isArray(parsed)) {
              // Successfully parsed JSON array by bracket matching
              return parsed;
            }
          } catch (e) {
            // 继续查找下一个
            startIndex = -1;
          }
        }
      }
    }

    // 方法4: 尝试查找所有可能的JSON数组并验证
    const arrayMatches = cleaned.match(/\[[\s\S]{20,}?\]/g); // 至少20个字符的数组
    if (arrayMatches) {
      // 从最长的开始尝试
      const sortedMatches = arrayMatches.sort((a, b) => b.length - a.length);
      for (const match of sortedMatches) {
        try {
          const parsed = JSON.parse(match);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Successfully parsed JSON array from regex match
            return parsed;
          }
        } catch (e) {
          // 继续尝试下一个
        }
      }
    }

    // 如果所有方法都失败，记录原始响应用于调试
    console.error('Failed to extract JSON from AI response. Response preview:', cleaned.substring(0, 500));
    return null;
  };

  // 验证和规范化生成的单元数据
  const validateAndNormalizeUnits = (rawUnits: any[]): GeneratedUnit[] => {
    const validUnits: GeneratedUnit[] = [];
    
    for (const unit of rawUnits) {
      // 验证必需字段
      if (!unit.title || !unit.focus || !unit.week || !unit.periods) {
        continue;
      }

      // 验证周次格式
      if (!validateWeekFormat(unit.week)) {
        continue;
      }

      // 验证和规范化关键概念
      const availableConcepts = getKeyConcepts();
      let keyConcepts: string[] = [];
      if (Array.isArray(unit.keyConcepts)) {
        // 只保留在清单中的概念，最多3个
        keyConcepts = unit.keyConcepts
          .filter((c: string) => availableConcepts.includes(c))
          .slice(0, 3);
      } else if (typeof unit.keyConcepts === 'string') {
        // 如果是字符串，尝试分割
        const concepts = unit.keyConcepts.split(/[,，]/).map((c: string) => c.trim());
        keyConcepts = concepts
          .filter((c: string) => availableConcepts.includes(c))
          .slice(0, 3);
      }

      // 如果没有有效概念，跳过这个单元
      if (keyConcepts.length === 0) {
        continue;
      }

      // 验证和计算课时数
      let periods = typeof unit.periods === 'number' ? unit.periods : parseInt(unit.periods, 10);
      if (isNaN(periods) || periods <= 0) {
        // 如果AI没有提供有效的课时数，根据周次自动计算
        periods = calculatePeriodsFromWeek(String(unit.week).trim());
      } else {
        // 如果AI提供了课时数，验证是否合理（允许±1的误差）
        const expectedPeriods = calculatePeriodsFromWeek(String(unit.week).trim());
        if (Math.abs(periods - expectedPeriods) > 1) {
          // 如果差异较大，使用计算值
          periods = expectedPeriods;
        }
      }

      validUnits.push({
        title: String(unit.title).trim(),
        focus: String(unit.focus).trim(),
        keyConcepts,
        week: String(unit.week).trim(),
        periods,
      });
    }

    return validUnits;
  };

  // 清除进度定时器
  const clearProgressInterval = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  };

  // 根据已用秒数计算模拟进度（0–85），用于「搜索+生成」阶段
  const computeProgressFromElapsed = (sec: number): number => {
    if (sec <= SEARCH_PHASE_SEC) {
      return Math.round((sec / SEARCH_PHASE_SEC) * 10);
    }
    const t = (sec - SEARCH_PHASE_SEC) / (ESTIMATED_DURATION_SEC - SEARCH_PHASE_SEC);
    return Math.min(85, Math.round(10 + t * 75));
  };

  // 处理文件上传
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 检查文件类型
    const validTypes = ['text/plain', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const validExtensions = ['.txt', '.pdf', '.doc', '.docx'];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    
    if (!validTypes.includes(file.type) && !validExtensions.includes(fileExtension)) {
      setError('不支持的文件格式。请上传 TXT、PDF 或 Word 文档。');
      return;
    }

    // 检查文件大小（限制为80MB）
    if (file.size > 80 * 1024 * 1024) {
      setError('文件大小不能超过 80MB');
      return;
    }

    setUploadedFile(file);
    setIsReadingFile(true);
    setError(null);

    // 读取文件内容
    const reader = new FileReader();
    
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        setUploadedFileContent(content);
        setIsReadingFile(false);
      } catch (err) {
        console.error('读取文件失败:', err);
        setError('读取文件失败，请重试');
        setIsReadingFile(false);
        setUploadedFile(null);
      }
    };

    reader.onerror = () => {
      setError('读取文件时发生错误');
      setIsReadingFile(false);
      setUploadedFile(null);
    };

    // 根据文件类型选择读取方式
    if (file.type === 'text/plain' || fileExtension === '.txt') {
      // TXT文件：直接读取文本
      reader.readAsText(file, 'UTF-8');
    } else if (file.type === 'application/pdf' || fileExtension === '.pdf') {
      // PDF文件：使用PDF解析库提取文本
      extractTextFromPDF(file)
        .then((text) => {
          setUploadedFileContent(text);
          setIsReadingFile(false);
        })
        .catch((err) => {
          console.error('PDF解析失败:', err);
          setError(`PDF解析失败: ${err instanceof Error ? err.message : '未知错误'}`);
          setIsReadingFile(false);
          setUploadedFile(null);
        });
    } else {
      // Word文件：暂不支持
      setError('当前支持 TXT 和 PDF 格式。Word 文件支持即将推出。');
      setIsReadingFile(false);
      setUploadedFile(null);
    }
  };

  // 清除上传的文件
  const handleRemoveFile = () => {
    setUploadedFile(null);
    setUploadedFileContent('');
    setError(null);
  };

  // 检查周次是否重叠
  const checkWeekOverlap = (units: GeneratedUnit[]): boolean => {
    const weekRanges: Array<{ start: number; end: number }> = [];
    
    for (const unit of units) {
      const [start, end] = unit.week.includes('-')
        ? unit.week.split('-').map(Number)
        : [Number(unit.week), Number(unit.week)];
      
      // 检查是否与已有范围重叠
      for (const range of weekRanges) {
        if (!(end < range.start || start > range.end)) {
          return true; // 有重叠
        }
      }
      
      weekRanges.push({ start, end });
    }
    
    return false;
  };

  // 生成单元数据
  const handleGenerate = async () => {
    // 如果没有上传文件，需要教材信息
    if (!uploadedFile && !textbookInfo.trim()) {
      setError('请上传教材文件或输入教材信息');
      return;
    }

    // 如果上传了文件但还没有读取完成
    if (uploadedFile && !uploadedFileContent) {
      setError('正在读取教材文件，请稍候...');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGenerationStatus(uploadedFile ? '📖 正在读取教材内容...' : '🔍 正在搜索教材信息...');
    setGeneratedUnits([]);
    setProgress(0);
    setElapsedSeconds(0);
    clearProgressInterval();

    const tickProgress = () => {
      setElapsedSeconds((s) => {
        const next = s + 1;
        setProgress(computeProgressFromElapsed(next));
        // 如果上传了文件，跳过搜索阶段，直接进入生成阶段
        if (uploadedFile) {
          if (next === 1) {
            setGenerationStatus('✨ 正在生成单元数据...');
          }
        } else {
          if (next === SEARCH_PHASE_SEC + 1) {
            setGenerationStatus('✨ 正在生成单元数据...');
          }
        }
        return next;
      });
    };
    progressIntervalRef.current = setInterval(tickProgress, 1000);

    try {
      // 构建提示词：如果有上传的教材内容，使用教材内容；否则使用搜索
      const textbookSource = uploadedFile 
        ? `【教材内容】（已上传教材文件：${uploadedFile.name}）\n${uploadedFileContent.substring(0, 50000)}` // 限制内容长度，避免超出token限制
        : `教材信息：${textbookInfo}（格式：课程类别-教材版本-学期，已包含年级与学期）`;

      const prompt = `你是一位专业的课程规划专家。请基于以下信息生成单元数据：

【课程信息】
${textbookSource}
学期总周数：${totalWeeks}周
${extraPrompt.trim() ? `\n【用户补充要求】（请优先遵循）\n${extraPrompt.trim()}\n` : ''}

【单元数量要求】
**重要：严格按照教材实际章节结构生成单元，不要补充或创造不存在的单元。**
${uploadedFile 
  ? '- 请仔细阅读上传的教材内容，确认该学期实际包含多少个单元\n- 如果教材只有4个单元，就只生成4个单元；如果教材有8个单元，就生成8个单元\n- 单元数量必须与教材实际章节数量完全一致，不能多也不能少'
  : '- 请先联网搜索教材的官方目录，确认该学期实际包含多少个单元\n- 如果教材只有4个单元，就只生成4个单元；如果教材有8个单元，就生成8个单元\n- 单元数量必须与教材实际章节数量完全一致，不能多也不能少'}
- 不要因为学期周数较多而补充额外的单元，也不要因为学期周数较少而合并单元

【关键概念清单（必须从以下概念中选择1-3个，不能自由填写）】
${getKeyConcepts().map((c, i) => `${i + 1}. ${c}`).join('\n')}

【任务要求】
${uploadedFile 
  ? `1. **基于上传的教材内容生成单元**：
   - 请仔细阅读上传的教材内容，理解教材的章节结构和教学安排
   - 严格按照教材中的单元顺序和名称生成，不要补充、合并或创造教材中不存在的单元
   - 如果教材单元数少于学期周数建议的数量，就按教材实际数量生成，不要为了填满学期而补充单元`
  : `1. **必须使用联网搜索功能**：请先联网搜索"${textbookInfo}"（课程类别-教材版本-学期）的官方单元目录和教学大纲
   - 必须搜索市面上最新版本的教材信息，不要使用过时的教材版本
   - 确保搜索到的信息是最新、最准确的官方资料
   - 如果教材有多个版本或年份，请优先使用最新版本
2. **严格按照教材实际章节生成单元**：
   - 先确认教材该学期实际包含多少个单元（例如：如果教材目录显示只有4个单元，就只生成4个单元）
   - 严格按照教材的单元顺序和名称生成，不要补充、合并或创造教材中不存在的单元
   - 如果教材单元数少于学期周数建议的数量，就按教材实际数量生成，不要为了填满学期而补充单元`}
${uploadedFile ? '2' : '3'}. 生成符合该年级认知水平的单元数据，每个单元需要包含：

【课程信息】
教材信息：${textbookInfo}（格式：课程类别-教材版本-学期，已包含年级与学期）
学期总周数：${totalWeeks}周

【单元数量要求】
**重要：严格按照教材实际章节结构生成单元，不要补充或创造不存在的单元。**
- 请先联网搜索教材的官方目录，确认该学期实际包含多少个单元
- 如果教材只有4个单元，就只生成4个单元；如果教材有8个单元，就生成8个单元
- 单元数量必须与教材实际章节数量完全一致，不能多也不能少
- 不要因为学期周数较多而补充额外的单元，也不要因为学期周数较少而合并单元

【关键概念清单（必须从以下概念中选择1-3个，不能自由填写）】
${getKeyConcepts().map((c, i) => `${i + 1}. ${c}`).join('\n')}

【任务要求】
1. **必须使用联网搜索功能**：请先联网搜索"${textbookInfo}"（课程类别-教材版本-学期）的官方单元目录和教学大纲
   - 必须搜索市面上最新版本的教材信息，不要使用过时的教材版本
   - 确保搜索到的信息是最新、最准确的官方资料
   - 如果教材有多个版本或年份，请优先使用最新版本
2. **严格按照教材实际章节生成单元**：
   - 先确认教材该学期实际包含多少个单元（例如：如果教材目录显示只有4个单元，就只生成4个单元）
   - 严格按照教材的单元顺序和名称生成，不要补充、合并或创造教材中不存在的单元
   - 如果教材单元数少于学期周数建议的数量，就按教材实际数量生成，不要为了填满学期而补充单元
3. 生成符合该年级认知水平的单元数据，每个单元需要包含：

   **标题要求：**
   - 标题必须基于教材章节的实际名称
   - 不要包含"第X单元"、"Unit X"、"单元X"等序号前缀
   - 标题应该简洁明确，直接反映单元主题
   - 例如：语文可以是"古诗文鉴赏"、"现代文阅读"等；数学可以是"分数运算"、"几何图形"等

   **核心内容要求（focus字段，双语凝练）：**
   - 每个单元的 focus 须先写中文，再写对应英文，便于教师跨学科理解；整体凝练、不冗杂、少细节。
   - 中文部分：按学科习惯概括（如语文：主要篇目 + 学习任务；历史/其他：核心内容 + 学习任务），简洁可操作。
   - 英文部分：紧接中文后，用对应英文概括同一内容，句式简短。
   - 语文示例：主要篇目：《阿长与<山海经>》（鲁迅）、《老王》（杨绛）。学习任务：体悟普通人美德，学习细节与心理描写；掌握“小人物大情怀”视角；积累文言实词。Celebrate the nobility of ordinary people; master psychological and detail-oriented characterization; adopt the "small figures, big impact" perspective; build classical vocabulary.
   - 历史示例：核心内容：隋唐统一、大运河与盛世治世；经济繁荣、民族交融与开放风气。学习任务：绘大运河图、析盛世成因、赏唐风诗画。Content: Sui-Tang unification, the Grand Canal, and the Golden Age. Tasks: Map the canal, analyze the prosperity, and appreciate Tang arts.
   - 数学/英语等学科同理：先中文要点与任务，再英文对应；单条不宜过长，总长度适中。

   **关键概念选择要求（keyConcepts字段）：**
   - 这是最重要的环节，必须经过仔细思考和验证
   - 选择前，请仔细分析该单元的整体教学内容、学习目标、核心能力培养
   - 从16个概念清单中选择1-3个，必须确保：
     * 所选概念能够准确概括该单元的核心学习价值
     * 所选概念与单元的教学内容高度匹配
     * 所选概念能够体现该单元对学生能力培养的贡献
   - 不要随意选择，不要因为某个概念"听起来相关"就选择
   - 如果单元内容确实只匹配1个概念，就只选1个；如果匹配2-3个，可以选择2-3个
   - 必须完全匹配清单中的名称，不能自创或变体

   **周次和课时要求：**
   - 周次分配（格式："1-3"或"1"，不重叠，覆盖整个学期${totalWeeks}周）
   - 课时数计算：该课程每周${weeklyPeriods}课时，请根据周次范围精确计算
     * 单周（如"1"）：${weeklyPeriods}课时
     * 多周（如"1-3"）：周数 × ${weeklyPeriods}课时 = 3周 × ${weeklyPeriods}课时 = ${3 * weeklyPeriods}课时
     * 请确保每个单元的课时数 = 周数 × ${weeklyPeriods}

${uploadedFile ? '3' : '4'}. 单元之间要有逻辑递进关系，体现教学的系统性和连贯性
${uploadedFile ? '4' : '5'}. 周次分配要合理，不重叠，尽量覆盖整个学期（从第1周到第${totalWeeks}周）
   - 如果教材单元数较少，周次可以适当延长每个单元的教学时间
   - 如果教材单元数较多，周次可以适当压缩每个单元的教学时间
   - **重要：不要为了覆盖整个学期而补充教材中不存在的单元**

【输出格式】
请以严格的JSON数组格式返回，不要添加任何额外的文字说明，只返回JSON数组。格式如下：
[
  {
    "title": "单元标题（不含序号前缀）",
    "focus": "核心内容（包含具体学习内容，如文章篇目、知识点、任务等）",
    "keyConcepts": ["审美 Aesthetics", "变化 Change"],
    "week": "1-3",
    "periods": 6
  },
  ...
]

**输出示例（focus 为中文+英文凝练格式）：**
{
  "title": "古诗文鉴赏",
  "focus": "主要篇目：《静夜思》（李白）、《春晓》（孟浩然）、《登鹳雀楼》（王之涣）。学习任务：理解古诗韵律与意境；背诵默写；了解创作背景与作者生平；古诗改写与创作。Understand rhythm and imagery; recite and write from memory; learn context and authorship; rewrite and create in classical style.",
  "keyConcepts": ["审美 Aesthetics", "文化 Culture"],
  "week": "1-3",
  "periods": 9
}

重要：请直接返回JSON数组，不要用markdown代码块包裹，不要添加任何解释文字。`;

      setGenerationStatus('✨ 正在生成单元数据...');

      // 创建带超时的fetch请求
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 120秒超时

      try {
        const response = await fetch(getApiUrl('/api/ai/generate'), {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            model: getModelCode(selectedModelId),
            messages: [
              {
                role: 'system',
                content: `你是一个专业的课程规划AI助手。请严格按照用户要求生成单元数据。

重要原则：
${uploadedFile 
  ? `1. **基于上传的教材内容生成**：请仔细阅读用户上传的教材内容，严格按照教材中的章节结构和单元信息生成单元数据
2. **严格按照教材实际章节生成**：必须严格按照教材中的实际单元数量和名称生成，不要补充、合并或创造教材中不存在的单元。如果教材只有4个单元，就只生成4个单元，不要为了填满学期而补充到8个单元。`
  : `1. **必须使用联网搜索功能**：请务必使用联网搜索功能获取教材信息，不要仅凭已有知识回答
2. **必须使用最新版本教材**：请搜索并使用市面上最新版本的教材信息，确保内容的时效性和准确性
3. **严格按照教材实际章节生成**：必须严格按照教材官方目录中的实际单元数量和名称生成，不要补充、合并或创造教材中不存在的单元。如果教材只有4个单元，就只生成4个单元，不要为了填满学期而补充到8个单元。`}
${uploadedFile ? '3' : '4'}. 若用户提供了【用户补充要求】，须优先遵循
${uploadedFile ? '4' : '5'}. 标题不要包含"第X单元"等序号前缀
${uploadedFile ? '5' : '6'}. 核心内容（focus）须双语凝练：先中文（要点+学习任务），再对应英文，简洁不冗杂，便于教师跨学科理解
${uploadedFile ? '6' : '7'}. 关键概念的选择必须经过仔细思考，确保与单元内容高度匹配，不能随意选择
${uploadedFile ? '7' : '8'}. 关键概念必须从提供的16个概念清单中选择，不能自由填写`,
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            stream: false,
            temperature: 0.5, // 降低temperature以提高响应速度和一致性
            max_tokens: 4000, // 限制最大token数，避免生成过长内容
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`API请求失败: ${response.statusText}`);
        }

        const data = await response.json();
        const aiResponse = data.choices[0]?.message?.content || '';

        if (!aiResponse) {
          throw new Error('AI未返回有效内容');
        }

        clearProgressInterval();
        setProgress(90);
        setGenerationStatus('📋 解析与校验...');

        // 记录原始响应用于调试（仅在开发环境）
        if (import.meta.env.DEV) {
          console.log('=== AI Response Debug ===');
          console.log('Response length:', aiResponse.length);
          console.log('Response preview (first 1000 chars):', aiResponse.substring(0, 1000));
          console.log('Response preview (last 500 chars):', aiResponse.substring(Math.max(0, aiResponse.length - 500)));
        }

        // 提取JSON
        const rawUnits = extractJSON(aiResponse);
        if (!rawUnits || rawUnits.length === 0) {
          // 提供更详细的错误信息
          const errorMsg = rawUnits === null 
            ? '未能从AI响应中提取JSON数据。AI可能返回了非JSON格式的内容。'
            : '提取到了JSON但数组为空。';
          console.error('=== JSON Extraction Failed ===');
          console.error('Full response:', aiResponse);
          console.error('Response type:', typeof aiResponse);
          console.error('Response contains "[" :', aiResponse.includes('['));
          console.error('Response contains "]" :', aiResponse.includes(']'));
          throw new Error(errorMsg + ' 请打开浏览器控制台查看详细信息，或重试。');
        }

        if (import.meta.env.DEV) {
          console.log(`✅ Successfully extracted ${rawUnits.length} units from AI response`);
          console.log('Raw units preview:', rawUnits.slice(0, 2));
        }

        // 验证和规范化
        const validUnits = validateAndNormalizeUnits(rawUnits);
        if (validUnits.length === 0) {
          console.error('Validation failed. Raw units:', rawUnits);
          throw new Error(`生成的单元数据验证失败：从${rawUnits.length}个原始单元中，0个通过了验证。可能原因：关键概念不在清单中、周次格式错误、或缺少必需字段。请重试。`);
        }

        if (import.meta.env.DEV) {
          console.log(`Validation passed: ${validUnits.length} valid units out of ${rawUnits.length} raw units`);
        }

        // 检查周次重叠
        if (checkWeekOverlap(validUnits)) {
          setError('警告：检测到周次重叠，请手动调整');
        }

        setGeneratedUnits(validUnits);
        setProgress(100);
        setGenerationStatus('✅ 生成完成！');
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error('请求超时（120秒），请检查网络连接或重试');
        }
        throw err;
      }
    } catch (err: any) {
      // 错误已在 catch 块中处理，这里不需要额外日志
      setError(err.message || '生成失败，请重试');
      setGenerationStatus('');
      setProgress(0);
      setElapsedSeconds(0);
    } finally {
      clearProgressInterval();
      setIsGenerating(false);
    }
  };

  // 编辑单元
  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setEditingUnit({ ...generatedUnits[index] });
  };

  // 保存编辑
  const handleSaveEdit = () => {
    if (editingIndex === null || !editingUnit) return;

    // 验证
    if (!validateWeekFormat(editingUnit.week)) {
      setError('周次格式不正确');
      return;
    }

    const conceptValidation = validateKeyConcepts(editingUnit.keyConcepts);
    if (!conceptValidation.valid) {
      setError(`以下关键概念不在清单中：${conceptValidation.invalid.join(', ')}`);
      return;
    }

    if (editingUnit.keyConcepts.length === 0) {
      setError('至少需要选择一个关键概念');
      return;
    }

    const updated = [...generatedUnits];
    updated[editingIndex] = editingUnit;
    setGeneratedUnits(updated);
    setEditingIndex(null);
    setEditingUnit(null);
    setError(null);
  };

  // 删除单元
  const handleDelete = (index: number) => {
    const updated = generatedUnits.filter((_, i) => i !== index);
    setGeneratedUnits(updated);
  };

  // 确认导入
  const handleConfirm = () => {
    if (generatedUnits.length === 0) {
      setError('没有可导入的单元');
      return;
    }

    // 最终验证
    if (checkWeekOverlap(generatedUnits)) {
      if (!window.confirm('检测到周次重叠，是否仍要导入？')) {
        return;
      }
    }

    onConfirm(generatedUnits);
    // 重置状态
    setTextbookInfo('');
    setExtraPrompt('');
    setTotalWeeks(20);
    setGeneratedUnits([]);
    setError(null);
    setGenerationStatus('');
    setUploadedFile(null);
    setUploadedFileContent('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-w-[95vw] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-500" />
            AI生成单元
          </DialogTitle>
          <DialogDescription>
            {uploadedFile 
              ? '已上传教材文件，AI将直接读取教材内容生成单元数据'
              : '通过AI搜索教材信息，或上传教材文件，自动生成单元数据'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {/* 输入表单 */}
          <div className="space-y-4 border-b pb-4">
            {/* 教材上传选项 */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                上传教材文件 <span className="text-gray-400 text-xs">(可选)</span>
              </label>
              {uploadedFile ? (
                <div className="flex items-center gap-2 p-3 border border-green-300 bg-green-50 rounded-md">
                  <div className="flex-1 flex items-center gap-2">
                    <Upload className="w-4 h-4 text-green-600" />
                    <span className="text-sm text-gray-700 truncate">{uploadedFile.name}</span>
                    {isReadingFile && (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveFile}
                    disabled={isGenerating || isReadingFile}
                    className="h-7 w-7 p-0"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="file"
                    accept=".txt,.pdf,.doc,.docx"
                    onChange={handleFileUpload}
                    disabled={isGenerating || isReadingFile}
                    className="hidden"
                    id="textbook-upload"
                  />
                  <label
                    htmlFor="textbook-upload"
                    className={`flex items-center justify-center gap-2 p-3 border-2 border-dashed rounded-md cursor-pointer transition-colors ${
                      isGenerating || isReadingFile
                        ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
                        : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50'
                    }`}
                  >
                    <Upload className="w-4 h-4 text-gray-500" />
                    <span className="text-sm text-gray-600">
                      {isReadingFile ? '正在读取文件...' : '点击上传教材文件 (TXT/PDF/Word)'}
                    </span>
                  </label>
                </div>
              )}
              <p className="text-xs text-gray-500 mt-1">
                支持 TXT、PDF 格式（Word 格式即将推出）。上传后将直接读取教材内容，无需搜索。
              </p>
              {error && error.includes('文件大小') && (
                <p className="text-xs text-red-500 mt-1">
                  {error}
                </p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                教材信息 {!uploadedFile && <span className="text-red-500">*</span>}
              </label>
              <Input
                value={textbookInfo}
                onChange={(e) => setTextbookInfo(e.target.value)}
                placeholder="例如：历史-统编版-七年级上学期"
                disabled={isGenerating || !!uploadedFile}
                className={uploadedFile ? 'bg-gray-50' : ''}
              />
              <p className="text-xs text-gray-500 mt-1">
                {uploadedFile 
                  ? '已上传教材文件，此字段已禁用'
                  : '格式：课程类别-教材版本-学期。已自动填充，可根据需要修改'}
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                补充说明 / 特定需求 <span className="text-gray-400 text-xs">(可选)</span>
              </label>
              <textarea
                value={extraPrompt}
                onChange={(e) => setExtraPrompt(e.target.value)}
                placeholder="例如：仅根据教材目录中的单元标题生成，由 AI 补充学习内容；或只生成前 4 个单元；或强调某版本某册的特定单元。"
                disabled={isGenerating}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 disabled:cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">
                用于补充生成要求或备注，会一并传给 AI 并优先遵循。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  学期总周数
                </label>
                <Input
                  type="number"
                  value={totalWeeks}
                  onChange={(e) => setTotalWeeks(Math.max(1, Math.min(40, parseInt(e.target.value) || 20)))}
                  min="1"
                  max="40"
                  disabled={isGenerating}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  AI模型
                </label>
                <select
                  value={selectedModelId}
                  onChange={(e) => {
                    const newModelId = e.target.value;
                    setSelectedModelId(newModelId);
                    saveModelId(newModelId);
                  }}
                  className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:bg-gray-50 disabled:cursor-not-allowed"
                  disabled={isGenerating}
                >
                  {AI_MODELS.filter((m) => m.kind !== 'image').map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={isGenerating || (!uploadedFile && !textbookInfo.trim()) || isReadingFile}
              className="w-full"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  开始生成
                </>
              )}
            </Button>
          </div>

          {/* 生成状态与进度 */}
          {generationStatus && (
            <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/80 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  {generationStatus.includes('✅') ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                  ) : (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
                  )}
                  <span>{generationStatus}</span>
                </div>
                {isGenerating && elapsedSeconds >= 0 && !generationStatus.includes('✅') && (
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>已用时 {elapsedSeconds} 秒</span>
                    {progress < 90 && (
                      <span>
                        预计还需约 {Math.max(0, ESTIMATED_DURATION_SEC - elapsedSeconds)} 秒
                      </span>
                    )}
                  </div>
                )}
              </div>
              {isGenerating && (
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}

          {/* 生成的单元预览 */}
          {generatedUnits.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-gray-800">
                生成的单元 ({generatedUnits.length}个)
              </h3>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {generatedUnits.map((unit, index) => (
                  <div
                    key={index}
                    className="border rounded-lg p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    {editingIndex === index ? (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-gray-600">标题</label>
                          <Input
                            value={editingUnit?.title || ''}
                            onChange={(e) => setEditingUnit({ ...editingUnit!, title: e.target.value })}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-600">核心内容</label>
                          <textarea
                            value={editingUnit?.focus || ''}
                            onChange={(e) => setEditingUnit({ ...editingUnit!, focus: e.target.value })}
                            className="mt-1 w-full px-3 py-2 border rounded-md"
                            rows={2}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-600">周次</label>
                          <Input
                            value={editingUnit?.week || ''}
                            onChange={(e) => setEditingUnit({ ...editingUnit!, week: e.target.value })}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-600">课时</label>
                          <Input
                            type="number"
                            value={editingUnit?.periods || 0}
                            onChange={(e) => setEditingUnit({ ...editingUnit!, periods: parseInt(e.target.value) || 0 })}
                            className="mt-1"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleSaveEdit}>
                            保存
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingIndex(null);
                              setEditingUnit(null);
                            }}
                          >
                            取消
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-semibold text-gray-800 mb-1">
                              {index + 1}. {unit.title}
                            </h4>
                            <p className="text-sm text-gray-600 mb-2">{unit.focus}</p>
                            <div className="flex flex-wrap gap-2 items-center">
                              <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded">
                                周次: {unit.week}
                              </span>
                              <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded">
                                课时: {unit.periods}
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {unit.keyConcepts.map((concept) => (
                                  <span
                                    key={concept}
                                    className="text-xs px-2 py-1 bg-purple-100 text-purple-800 rounded"
                                  >
                                    {concept}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 ml-4">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(index)}
                            >
                              <Edit2 className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                if (window.confirm('确定删除这个单元吗？')) {
                                  handleDelete(index);
                                }
                              }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={generatedUnits.length === 0 || isGenerating}
          >
            确认导入 ({generatedUnits.length}个单元)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
