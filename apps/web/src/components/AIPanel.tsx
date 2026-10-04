/**
 * 统一 SUIS AI 面板：从主界面（SUIS AI 格）或子应用顶栏打开，Gemini 风格布局。
 * 全屏主入口为左侧常驻对话列表；手机课程河流为抽屉；桌面半屏课程河流无侧栏，顶栏历史图标打开居中会话列表。
 * 主区：模型选择、问候/消息、底部输入；输入栏左侧为上传、模式、上下文等。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import {
  useAIContext,
  buildBasicCurriculumPayload,
  buildBasicStudentPortraitPayload,
  buildBasicTeacherPortraitPayload,
  type AIScreenId,
  type CurriculumRoadmapPayload,
} from '../contexts/AIContext';
import { buildStudentPortraitAIContextString, type StudentPortraitAIPayload } from '../lib/studentPortraitAIContext';
import { buildTeacherPortraitAIContextString, type TeacherPortraitAIPayload } from '../lib/teacherPortraitAIContext';
import { Course } from '../types';
import { loadSemesterDataSync } from '../lib/storage';
import { AI_MODELS, getSavedModelId, saveModelId, getModelCode } from '../lib/aiModels';
import { getApiUrl, getAuthHeaders } from '../lib/api';
import { formatNavUserLabel } from '../lib/userDisplay';
import {
  Send,
  User,
  Bot,
  Loader2,
  Paperclip,
  Globe,
  ChevronDown,
  Check,
  FilePen,
  X,
  Menu,
  History,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { aiMarkdownComponents, aiRemarkPlugins } from './aiMarkdown';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import AppTopBar from './AppTopBar';

const CHAT_LIST_KEY = 'ai-chat-list';
const CHAT_MSGS_PREFIX = 'ai-chat-msgs-';

interface ChatEntry {
  id: string;
  title: string;
  updatedAt: number;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoningContent?: string;
  reasoningTime?: number;
}

function buildContextString(screenId: AIScreenId, payload: Record<string, unknown>, isZh: boolean): string {
  if (!screenId || screenId === 'hub') {
    return '当前无特定课程或学生中心等应用上下文。用户可能从 SUIS AI 主入口直接发起对话，你需要根据提问内容，在协和双语学校真实教学与校园场景下进行理解与回答。';
  }
  if (screenId === 'curriculum-roadmap') {
    const p = payload as unknown as CurriculumRoadmapPayload;
    const courses = (p.courses || []) as Course[];
    let ctx = '当前正在使用的课程规划应用上下文：\n';
    if (p.basic) {
      ctx += '（基础模式：仅课程列表与概念库，无聚焦学期）\n';
      ctx += `已有课程列表：${courses.map((c: Course) => c.name).join(', ')}\n`;
      const concepts = (p.keyConcepts || []) as string[];
      if (concepts.length > 0) {
        ctx += '\n全局关键概念库：\n';
        ctx += concepts.map((c: string) => `- ${c}`).join('\n') + '\n';
      }
      return ctx;
    }
    const viewMode = (p.viewMode || 'overview') as string;
    ctx += `当前视图：${viewMode === 'focus' ? '聚焦视图' : '整体视图'}\n`;
    const focusSemester = p.focusSemester as { grade: number; semester: string } | undefined;
    if (viewMode === 'focus' && focusSemester) {
      ctx += `当前聚焦学期：G${focusSemester.grade} ${focusSemester.semester}\n`;
      ctx += '该学期课程内容：\n';
      courses.forEach((course: Course) => {
        const data = loadSemesterDataSync(course.id, focusSemester.grade, focusSemester.semester as 'Semester 1' | 'Semester 2');
        if (data?.units?.length) {
          ctx += `- 【${course.name}】：\n`;
          data.units.sort((a, b) => a.order - b.order).forEach((u) => {
            ctx += `  * Unit ${u.order + 1}: ${u.title} (周次: ${u.week})\n`;
            ctx += `    核心内容: ${u.focus}\n`;
          });
        }
      });
    } else {
      ctx += `已有课程列表：${courses.map((c: Course) => c.name).join(', ')}\n`;
    }
    return ctx;
  }
  if (screenId === 'student-portrait') {
    return buildStudentPortraitAIContextString(payload as unknown as StudentPortraitAIPayload, isZh);
  }
  if (screenId === 'teacher-portrait') {
    return buildTeacherPortraitAIContextString(payload as unknown as TeacherPortraitAIPayload, isZh);
  }
  return `当前应用上下文：${screenId}。`;
}

const SYSTEM_PROMPT_GENERAL = `你是“SUIS AI”，协和双语学校（Shanghai United International School）的智能助手。

你的职责：
- 面向教师、教务团队和学校管理者，围绕教学设计、课堂活动、学生发展、家校沟通、校园文化等场景提供建议和内容支持。
- 你不是通用聊天机器人，应始终站在“协和双语学校一线教师或管理者的真实情境”中思考问题。
- 回答时要兼顾中英双语学校的特点（课程体系、学生背景、家校沟通风格等），但不要编造学校不存在的官方文件或政策。

回答原则：
- 优先明确用户的角色和目标（例如：小学语文老师、初中数学老师、德育主任等），必要时可以先用 1～2 句追问澄清。
- 给出结构化、可落地的建议，多用分点、清单和示范表达方式，避免空泛的大话。
- 能落到“具体课堂活动 / 操作步骤 / 话术示例”时，就不要停留在纯理论层面。

请务必使用 Markdown 格式输出，利用加粗、列表、分级标题等方式让内容层次分明、易于阅读。

`;

const SYSTEM_PROMPT_STUDENT_PORTRAIT = `你是学生中心智能助手，辅助班主任、年级组长、学科组长与任课教师理解班级与学生学情。

你可以看到用户当前在学生中心界面上能看到的结构化数据（班级统计、学科均分、学生成绩摘要、考试趋势、学科支持计划、班主任评语等）。考试学科的满分随**具体学业报告及其所属学期**从后台配置解析（同一学年上下学期、不同报告可能满分不同，如科学上学期 50、下学期 100）；上下文会标明对应报告名称，分数也可能以「得分/满分（得分率%）」形式出现。跨学期趋势中每个数据点使用**该点所属报告**的满分。分析时请结合满分与得分率，勿把不同满分的学科或不同学期的分数直接比绝对值。请基于这些数据作答，不要编造未出现在上下文中的分数或评价。

回答原则：
- 先概括整体情况，再指出值得关注的学生或学科；区分「事实数据」与「分析建议」。
- 涉及个别学生时注意隐私与建设性表述，避免标签化。
- 若上下文数据不足，明确说明并建议用户切换到有数据的报告或选中具体学生。

请务必使用 Markdown 格式输出，利用加粗、列表、分级标题等方式让内容层次分明、易于阅读。

`;

const SYSTEM_PROMPT_TEACHER_PORTRAIT = `你是教师中心智能助手，辅助学科组长、年级组长、班主任与学校管理者理解教师发展、学科组质量与学校整体教学数据。

你可以看到用户当前在教师中心界面上能看到的结构化数据（学校 KPI、学业报告完成度、学科看板年级×班级均分、教学诊断提交情况等）。在学科看板/全校成绩视图中，若所选为学业报告，上下文会包含该报告下各考试学科的满分（如科学 50、语文 100，随报告学期配置），均分也可能以「得分/满分（得分率%）」呈现；分析时请结合满分与得分率，勿把不同满分的学科直接比绝对值。请基于这些数据作答，不要编造未出现在上下文中的分数或评价。

回答原则：
- 学科看板场景：先概括年级与班级整体水平，再指出班级间差异、薄弱学科或需关注的教师；区分「事实数据」与「分析建议」。
- 学校看板场景：关注完成率、待关注班级与负荷分布，给出可操作的跟进建议。
- 若上下文数据不足，明确说明并建议用户切换到有数据的报告或进入学科看板后再提问。

请务必使用 Markdown 格式输出，利用加粗、列表、分级标题等方式让内容层次分明、易于阅读。

`;

const SYSTEM_PROMPT_COURSE = `你是一个专业的课程规划 AI 助手，名为"课程河流智能体"。你的目标是辅助教师进行课程设计、跨学科活动策划和教学内容优化。你可以看到用户当前的课程数据上下文，并据此给出精准建议。

**跨学科学习（IDL）核心理念：**
- 跨学科学习的核心是创造性地解决真实问题。学科学习与跨学科学习相互成就，学科是地基。
- 跨学科不是"学科+学科"，而是"问题+工具"——一种不惧未知、敢于试错的问题解决思维。
- IDL 教学追求"把真实思维带进课堂"。

**跨学科设计的数量与合理性（务必遵守）：**
- 少而精优于多而泛：参与学科以 3 个左右为佳，具体根据项目与情境的真实需要来定。
- 在「参与单元」中只列出真正参与、有明确角色与贡献的学科。

请务必使用 Markdown 格式输出，利用加粗、列表、分级标题等方式让内容层次分明、易于阅读。

`;

interface AIPanelProps {
  fullScreen: boolean;
  /** 是否从主 Hub 直接进入；子应用半窗模式会传 false，用右上角 X 关闭 */
  fromHub: boolean;
  onClose: () => void;
  /** 语言切换仅在主 HUB（CompassHub）展示；从 HUB 进入的 AI 顶栏不传或传 false */
  showLanguageToggle?: boolean;
}

export default function AIPanel({ fullScreen, fromHub, onClose, showLanguageToggle = false }: AIPanelProps) {
  /** 课程河流半屏侧栏：不用全屏 fixed 顶栏，避免与左侧顶栏叠在一起且无明确关闭入口 */
  const dockedInSplitView = !fullScreen && !fromHub;
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  );
  /** 主 HUB 进入的全屏 SUIS AI：桌面左侧对话列表常驻；手机改为默认收起的抽屉 */
  const persistLeftSidebar = fullScreen && fromHub && !isNarrow;
  /** 手机全屏：历史栏是抽屉。桌面半屏课程河流无侧栏，用顶栏历史图标打开居中会话列表 */
  const drawerSidebarMode = !persistLeftSidebar && !dockedInSplitView;
  const { user } = useAuth();
  const { t, language, setLanguage } = useLanguage();
  const { screenId, setScreenId, contextPayload, setContextPayload } = useAIContext();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const historySwipeRef = useRef<{ x: number; y: number; ignore: boolean } | null>(null);
  const [historyPopoverOpen, setHistoryPopoverOpen] = useState(false);
  const [enableWeb, setEnableWeb] = useState(false);
  const [chatList, setChatList] = useState<ChatEntry[]>(() => {
    try {
      const raw = localStorage.getItem(CHAT_LIST_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      }
    } catch (_) {}
    return [];
  });
  const [currentChatId, setCurrentChatId] = useState<string | null>(chatList[0]?.id ?? null);
  const [messages, setMessages] = useState<Message[]>(() => {
    if (!chatList[0]) return [];
    try {
      const raw = localStorage.getItem(CHAT_MSGS_PREFIX + chatList[0].id);
      if (raw) {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      }
    } catch (_) {}
    return [];
  });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string>(getSavedModelId());
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [deleteConfirmChatId, setDeleteConfirmChatId] = useState<string | null>(null);
  const [expandedReasoning, setExpandedReasoning] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const displayName = user != null ? formatNavUserLabel(user) : language === 'zh' ? '用户' : 'User';
  const isZh = language === 'zh';
  const greetingText = isZh ? t('ai.panel.greeting').replace('{name}', displayName) : t('ai.panel.greetingEn').replace('{name}', displayName);

  const persistChatList = useCallback((list: ChatEntry[]) => {
    setChatList(list);
    try {
      localStorage.setItem(CHAT_LIST_KEY, JSON.stringify(list));
    } catch (_) {}
  }, []);

  const loadMessagesFor = useCallback((chatId: string) => {
    try {
      const raw = localStorage.getItem(CHAT_MSGS_PREFIX + chatId);
      setMessages(raw ? JSON.parse(raw) : []);
    } catch (_) {
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    if (currentChatId) loadMessagesFor(currentChatId);
    else setMessages([]);
  }, [currentChatId, loadMessagesFor]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) setContextMenuOpen(false);
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) setModelMenuOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const apply = () => setIsNarrow(mql.matches);
    apply();
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (isNarrow) setSidebarCollapsed(true);
  }, [isNarrow]);

  useEffect(() => {
    if (!dockedInSplitView || !historyPopoverOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHistoryPopoverOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dockedInSplitView, historyPopoverOpen]);

  const handleNewChat = () => {
    setCurrentChatId(null);
    setMessages([]);
    setContextMenuOpen(false);
    if (persistLeftSidebar) return;
    if (dockedInSplitView) setHistoryPopoverOpen(false);
    else setSidebarCollapsed(true);
  };

  const handleSelectChat = (id: string) => {
    setCurrentChatId(id);
    loadMessagesFor(id);
    if (persistLeftSidebar) return;
    if (dockedInSplitView) setHistoryPopoverOpen(false);
    else setSidebarCollapsed(true);
  };

  const handleDeleteChatConfirm = (chatId: string) => {
    const nextList = chatList.filter((c) => c.id !== chatId);
    persistChatList(nextList);
    try {
      localStorage.removeItem(CHAT_MSGS_PREFIX + chatId);
    } catch (_) {}
    if (currentChatId === chatId) {
      const nextCurrent = nextList[0]?.id ?? null;
      setCurrentChatId(nextCurrent);
      if (nextCurrent) loadMessagesFor(nextCurrent);
      else setMessages([]);
    }
    setDeleteConfirmChatId(null);
  };

  const handleDeleteChatClick = (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    if (dockedInSplitView) setHistoryPopoverOpen(false);
    setDeleteConfirmChatId(chatId);
  };

  const handleContextSelect = (id: AIScreenId) => {
    setScreenId(id);
    if (id === 'curriculum-roadmap') {
      setContextPayload(buildBasicCurriculumPayload());
    } else if (id === 'student-portrait') {
      setContextPayload(buildBasicStudentPortraitPayload());
    } else if (id === 'teacher-portrait') {
      setContextPayload(buildBasicTeacherPortraitPayload());
    } else {
      setContextPayload({});
    }
    setContextMenuOpen(false);
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMessage: Message = { role: 'user', content: input.trim() };
    let chatId = currentChatId;
    if (!chatId) {
      chatId = 'chat-' + Date.now();
      const title = userMessage.content.slice(0, 30) + (userMessage.content.length > 30 ? '...' : '');
      const entry: ChatEntry = { id: chatId, title, updatedAt: Date.now() };
      persistChatList([entry, ...chatList]);
      setCurrentChatId(chatId);
    } else {
      const list = chatList.map((c) => (c.id === chatId ? { ...c, title: userMessage.content.slice(0, 30) + (userMessage.content.length > 30 ? '...' : ''), updatedAt: Date.now() } : c));
      persistChatList(list);
    }
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    const context = buildContextString(screenId, contextPayload as Record<string, unknown>, language === 'zh');
    const systemBase =
      screenId === 'curriculum-roadmap'
        ? SYSTEM_PROMPT_COURSE
        : screenId === 'student-portrait'
          ? SYSTEM_PROMPT_STUDENT_PORTRAIT
          : screenId === 'teacher-portrait'
            ? SYSTEM_PROMPT_TEACHER_PORTRAIT
            : SYSTEM_PROMPT_GENERAL;
    const systemContent = systemBase + `\n${context}`;
    const systemPrompt: Message = { role: 'system', content: systemContent };
    const historyToSend = newMessages.slice(-10);

    try {
      const response = await fetch(getApiUrl('/api/ai/chat'), {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          model: getModelCode(selectedModelId),
          messages: [systemPrompt, ...historyToSend],
          stream: true,
          temperature: 0.7,
          max_tokens: 2000,
          enable_web_search: enableWeb,
        }),
      });
      if (!response.ok) throw new Error('API Request failed');
      if (!response.body) {
        setMessages((prev) => [...prev, { role: 'assistant', content: t('ai.assistant.errorMessage') }]);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let reasoningContent = '';
      const reasoningStartTime = Date.now();
      let reasoningEndTime: number | null = null;
      let hasReceivedReasoning = false;
      let hasReceivedContent = false;
      setMessages((prev) => [...prev, { role: 'assistant', content: '', reasoningContent: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (!reasoningEndTime) reasoningEndTime = Date.now();
          break;
        }
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const choice = json.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta || {};
            const content = delta.content || '';
            const reasoning = delta.reasoning_content || '';
            if (content) {
              assistantContent += content;
              hasReceivedContent = true;
            }
            if (reasoning) {
              reasoningContent += reasoning;
              hasReceivedReasoning = true;
            }
            if (choice.finish_reason && !reasoningEndTime) reasoningEndTime = Date.now();
            const currentTime = reasoningEndTime || Date.now();
            const reasoningTime = Math.round((currentTime - reasoningStartTime) / 1000);
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              return [
                ...prev.slice(0, -1),
                { ...last, content: assistantContent, reasoningContent: reasoningContent || undefined, reasoningTime: hasReceivedReasoning || hasReceivedContent ? reasoningTime : undefined },
              ];
            });
          } catch (_) {}
        }
      }
      const finalTime = reasoningEndTime ? Math.round((reasoningEndTime - reasoningStartTime) / 1000) : Math.round((Date.now() - reasoningStartTime) / 1000);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), { ...last, reasoningContent: reasoningContent || undefined, reasoningTime: hasReceivedReasoning || hasReceivedContent ? finalTime : undefined }];
      });
    } catch (error) {
      console.error('AI Chat Error:', error);
      setMessages((prev) => [...prev, { role: 'assistant', content: t('ai.assistant.errorMessage') }]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!currentChatId || messages.length === 0) return;
    try {
      localStorage.setItem(CHAT_MSGS_PREFIX + currentChatId, JSON.stringify(messages));
    } catch (_) {}
  }, [currentChatId, messages]);

  const contextLabel =
    screenId === null || screenId === 'hub'
      ? t('ai.panel.contextNone')
      : screenId === 'curriculum-roadmap'
        ? t('ai.panel.contextCurriculum')
        : screenId === 'student-portrait'
          ? t('ai.panel.contextStudent')
          : screenId === 'teacher-portrait'
            ? t('ai.panel.contextTeacher')
            : t('ai.panel.contextNone');
  const hasContext = screenId !== null && screenId !== 'hub';

  const chatListItems = chatList.map((c) => (
    <div
      key={c.id}
      className={`flex items-center gap-1 group rounded-lg ${
        currentChatId === c.id ? 'bg-blue-100 text-blue-800' : 'hover:bg-slate-200/80 text-slate-700'
      }`}
    >
      <button
        type="button"
        onClick={() => handleSelectChat(c.id)}
        className="flex-1 min-w-0 text-left px-3 py-2 rounded-lg text-sm truncate"
      >
        {c.title || c.id}
      </button>
      <button
        type="button"
        onClick={(e) => handleDeleteChatClick(e, c.id)}
        className="p-1.5 rounded-md hover:bg-slate-300/80 text-slate-500 hover:text-slate-700 flex-shrink-0"
        aria-label={isZh ? '删除对话' : 'Delete chat'}
        title={isZh ? '删除对话' : 'Delete chat'}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  ));

  const langToggle = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setLanguage(isZh ? 'en' : 'zh')}
      className="h-9 rounded-lg px-3 min-w-[2.5rem]"
      title={isZh ? 'Switch to English' : '切换到中文'}
    >
      {isZh ? 'EN' : '中'}
    </Button>
  );

  const content = (
    <div className="flex flex-col h-full bg-white">
      {dockedInSplitView ? (
        <header className="shrink-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
          <span className="text-base font-semibold text-slate-900 truncate">SUIS AI</span>
          <div className="flex items-center gap-2 flex-shrink-0">
            {showLanguageToggle && langToggle}
            <Button
              variant="outline"
              size="icon"
              onClick={onClose}
              className="h-9 w-9 rounded-lg"
              title={isZh ? '关闭' : 'Close'}
              aria-label={isZh ? '关闭 AI 侧边栏' : 'Close AI panel'}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>
      ) : (
        <AppTopBar
          title="SUIS AI"
          showBack
          onBack={onClose}
          rightChildren={showLanguageToggle ? langToggle : undefined}
        />
      )}

      <div
        className={`flex flex-1 min-h-0 ${dockedInSplitView ? '' : 'pt-[var(--app-topbar-height)]'} ${
          persistLeftSidebar ? 'flex-row min-w-0 overflow-hidden' : 'relative'
        }`}
        onPointerDown={(e) => {
          if (!drawerSidebarMode || e.button !== 0) return;
          const target = e.target as HTMLElement | null;
          historySwipeRef.current = {
            x: e.clientX,
            y: e.clientY,
            ignore: Boolean(target?.closest('button, a, input, textarea, select')),
          };
        }}
        onPointerUp={(e) => {
          const start = historySwipeRef.current;
          historySwipeRef.current = null;
          if (!start || start.ignore || !drawerSidebarMode) return;
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy)) return;
          setSidebarCollapsed(dx < 0);
        }}
      >
        {/* 仅手机全屏课程河流 AI：遮罩 + 左侧滑入抽屉；半屏为居中历史浮层，无侧栏 */}
        {drawerSidebarMode && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setSidebarCollapsed(true)}
            onKeyDown={(e) => e.key === 'Enter' && setSidebarCollapsed(true)}
            className={`fixed inset-0 top-[var(--app-topbar-height)] z-20 bg-black/20 transition-opacity duration-200 ${
              sidebarCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
            }`}
            aria-label="关闭侧边栏"
            aria-hidden={sidebarCollapsed}
          />
        )}
        {(persistLeftSidebar || drawerSidebarMode) && (
          <aside
            className={
              persistLeftSidebar
                ? 'flex h-full min-h-0 w-[202px] sm:w-[230px] shrink-0 flex-col border-r border-slate-200 bg-white'
                : `fixed left-0 top-[var(--app-topbar-height)] bottom-0 z-30 flex flex-col border-r border-slate-200 bg-white shadow-xl transition-transform duration-200 ease-out w-[51.84%] max-w-[202px] sm:max-w-[230px] ${
                    sidebarCollapsed ? '-translate-x-full pointer-events-none' : 'translate-x-0'
                  }`
            }
            aria-hidden={persistLeftSidebar ? undefined : sidebarCollapsed}
          >
            {/* 顶行：新聊天；抽屉模式右侧为收起 */}
            <div className="flex items-center justify-between gap-2 px-2 py-2 flex-shrink-0">
              <button
                type="button"
                onClick={handleNewChat}
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-200/80 text-sm font-medium text-slate-700"
              >
                <FilePen className="h-4 w-4 flex-shrink-0" />
                {t('ai.panel.newChat')}
              </button>
              {drawerSidebarMode && (
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(true)}
                  className="p-2 rounded-lg hover:bg-slate-200 text-slate-600"
                  aria-label="关闭"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
            <div className="px-3 pb-2 text-xs font-medium text-slate-500 flex-shrink-0">{t('ai.panel.chats')}</div>
            <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5 min-h-0">{chatListItems}</div>
          </aside>
        )}

        {/* Main */}
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {/* 主内容区左上角：半屏为历史记录；手机抽屉为菜单；常驻侧栏时仅模型 */}
          <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2">
            {dockedInSplitView && (
              <button
                type="button"
                onClick={() => setHistoryPopoverOpen((open) => !open)}
                className={`p-2 rounded-lg hover:bg-slate-100 text-slate-600 ${historyPopoverOpen ? 'bg-slate-100' : ''}`}
                aria-label={isZh ? '聊天记录' : 'Chat history'}
                title={isZh ? '聊天记录' : 'Chat history'}
              >
                <History className="h-5 w-5" />
              </button>
            )}
            {drawerSidebarMode && (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"
                aria-label={isZh ? '打开菜单' : 'Open menu'}
                title={isZh ? '打开对话与设置' : 'Open chats & settings'}
              >
                <Menu className="h-5 w-5" />
              </button>
            )}
            <div className="relative" ref={modelMenuRef}>
              <button
                type="button"
                disabled={isLoading}
                aria-expanded={modelMenuOpen}
                aria-haspopup="listbox"
                onClick={() => setModelMenuOpen((open) => !open)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-800 shadow-sm disabled:opacity-60"
              >
                <span>{AI_MODELS.find((m) => m.id === selectedModelId)?.name ?? 'AI'}</span>
                <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${modelMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {modelMenuOpen ? (
                <div
                  role="listbox"
                  className="absolute left-0 top-full z-50 mt-1 min-w-full w-max max-w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                >
                  {AI_MODELS.filter((m) => m.kind !== 'image').map((m) => {
                    const selected = m.id === selectedModelId;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`flex w-full items-center justify-between gap-4 px-3 py-2.5 text-left text-sm ${
                          selected ? 'bg-slate-50 font-medium text-slate-900' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                        onClick={() => {
                          setSelectedModelId(m.id);
                          saveModelId(m.id);
                          setModelMenuOpen(false);
                        }}
                      >
                        <span className="whitespace-nowrap">{m.name}</span>
                        {selected ? <Check className="h-4 w-4 shrink-0 text-blue-600" /> : <span className="h-4 w-4 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
          {messages.length === 0 && !isLoading ? (
            <>
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center mb-4">
                  <Bot className="w-10 h-10 text-blue-600" />
                </div>
                <h2 className="text-xl font-semibold text-slate-800 mb-2">{greetingText}</h2>
              </div>
              <div className="flex-shrink-0 px-4 sm:px-6 pb-6 sm:pb-8">
                <div className="w-full max-w-2xl mx-auto rounded-2xl border border-slate-100 bg-white shadow-lg overflow-visible">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={t('ai.assistant.placeholder')}
                    rows={2}
                    className="w-full px-4 pt-3 pb-1 text-sm focus:outline-none focus:ring-0 resize-none bg-transparent"
                  />
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <div className="flex items-center gap-0.5">
                      <button type="button" className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title={t('ai.panel.upload')}>
                        <Paperclip className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEnableWeb((v) => !v)}
                        className={`p-2 rounded-lg ${enableWeb ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100 text-slate-500'}`}
                        title={t('ai.panel.modeWeb')}
                      >
                        <Globe className="h-4 w-4" />
                      </button>
                      <div className="relative" ref={contextMenuRef}>
                        <button
                          type="button"
                          onClick={() => setContextMenuOpen((o) => !o)}
                          className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium ${
                            hasContext ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100 text-slate-600'
                          }`}
                          title={contextLabel}
                        >
                          <span className="max-w-[80px] truncate">{contextLabel}</span>
                          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
                        </button>
                        {contextMenuOpen && (
                          <div className="absolute left-0 bottom-full mb-1 w-48 rounded-lg border border-slate-200 bg-white shadow-lg py-1 z-50">
                            <button type="button" onClick={() => handleContextSelect(null)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 flex items-center gap-2">
                              {screenId === null || screenId === 'hub' ? '✓ ' : ''}{t('ai.panel.contextNone')}
                            </button>
                            <button type="button" onClick={() => handleContextSelect('curriculum-roadmap')} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 flex items-center gap-2">
                              {screenId === 'curriculum-roadmap' ? '✓ ' : ''}{t('ai.panel.contextCurriculum')}
                            </button>
                            <button type="button" onClick={() => handleContextSelect('student-portrait')} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 flex items-center gap-2">
                              {screenId === 'student-portrait' ? '✓ ' : ''}{t('ai.panel.contextStudent')}
                            </button>
                            <button type="button" onClick={() => handleContextSelect('teacher-portrait')} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 flex items-center gap-2">
                              {screenId === 'teacher-portrait' ? '✓ ' : ''}{t('ai.panel.contextTeacher')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={!input.trim() || isLoading}
                      className={`p-2 rounded-lg ${
                        input.trim() && !isLoading ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.filter((m) => m.role !== 'system').map((msg, index) => {
                  if (msg.role === 'user') {
                    return (
                      <div key={index} className="flex justify-end">
                        <div className="max-w-[85%] flex gap-2 flex-row-reverse">
                          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                            <User className="w-4 h-4 text-slate-600" />
                          </div>
                          <div className="px-3 py-2 rounded-2xl bg-blue-600 text-white text-sm rounded-tr-none">
                            {msg.content}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  const hasReasoning = msg.reasoningContent && msg.reasoningContent.trim().length > 0;
                  const isExpanded = expandedReasoning.has(index);
                  return (
                    <div key={index} className="flex justify-start">
                      <div className="max-w-[85%] flex gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <Bot className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className="px-3 py-2 rounded-2xl bg-white border border-slate-100 rounded-tl-none text-sm text-slate-800 shadow-sm">
                          {hasReasoning && (
                            <div className="mb-2 border-t border-slate-200 pt-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const next = new Set(expandedReasoning);
                                  if (isExpanded) next.delete(index);
                                  else next.add(index);
                                  setExpandedReasoning(next);
                                }}
                                className="text-xs text-slate-500 hover:text-slate-700"
                              >
                                {isExpanded ? '收起' : '展开'} {t('ai.assistant.reasoning')}
                              </button>
                              {isExpanded && (
                                <div className="mt-1 p-2 bg-slate-50 rounded text-xs font-mono whitespace-pre-wrap">
                                  {msg.reasoningContent}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="markdown-content">
                            <ReactMarkdown remarkPlugins={aiRemarkPlugins} components={aiMarkdownComponents}>
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="flex gap-2">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                        <Bot className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="p-3 rounded-2xl bg-white border border-slate-100">
                        <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 输入框：无外容器，仅窗体 + 阴影（参考 Gemini） */}
              <div className="flex-shrink-0 p-4 px-4 sm:px-6 pb-6">
                <div className="max-w-2xl mx-auto rounded-2xl border border-slate-100 bg-white shadow-lg overflow-visible">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={t('ai.assistant.placeholder')}
                    rows={1}
                    className="w-full px-4 pt-3 pb-1 text-sm focus:outline-none focus:ring-0 resize-none bg-transparent max-h-32"
                  />
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <div className="flex items-center gap-0.5">
                      <button type="button" className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title={t('ai.panel.upload')}>
                        <Paperclip className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEnableWeb((v) => !v)}
                        className={`p-2 rounded-lg ${enableWeb ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100 text-slate-500'}`}
                        title={t('ai.panel.modeWeb')}
                      >
                        <Globe className="h-4 w-4" />
                      </button>
                      <div className="relative" ref={contextMenuRef}>
                        <button
                          type="button"
                          onClick={() => setContextMenuOpen((o) => !o)}
                          className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium ${
                            hasContext ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100 text-slate-600'
                          }`}
                          title={contextLabel}
                        >
                          <span className="max-w-[80px] truncate">{contextLabel}</span>
                          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
                        </button>
                        {contextMenuOpen && (
                          <div className="absolute left-0 bottom-full mb-1 w-48 rounded-lg border border-slate-200 bg-white shadow-lg py-1 z-50">
                            <button type="button" onClick={() => handleContextSelect(null)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 flex items-center gap-2">
                              {screenId === null || screenId === 'hub' ? '✓ ' : ''}{t('ai.panel.contextNone')}
                            </button>
                            <button type="button" onClick={() => handleContextSelect('curriculum-roadmap')} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 flex items-center gap-2">
                              {screenId === 'curriculum-roadmap' ? '✓ ' : ''}{t('ai.panel.contextCurriculum')}
                            </button>
                            <button type="button" onClick={() => handleContextSelect('student-portrait')} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 flex items-center gap-2">
                              {screenId === 'student-portrait' ? '✓ ' : ''}{t('ai.panel.contextStudent')}
                            </button>
                            <button type="button" onClick={() => handleContextSelect('teacher-portrait')} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 flex items-center gap-2">
                              {screenId === 'teacher-portrait' ? '✓ ' : ''}{t('ai.panel.contextTeacher')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={!input.trim() || isLoading}
                      className={`p-2 rounded-lg ${
                        input.trim() && !isLoading ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {dockedInSplitView && historyPopoverOpen && (
            <div
              className="absolute inset-0 z-40 flex items-center justify-center bg-slate-900/25 p-4"
              onClick={() => setHistoryPopoverOpen(false)}
              role="presentation"
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="ai-history-popover-title"
                className="flex max-h-[min(72vh,420px)] w-full max-w-sm flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
                  <span id="ai-history-popover-title" className="text-sm font-semibold text-slate-800">
                    {t('ai.panel.chats')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setHistoryPopoverOpen(false)}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    aria-label={isZh ? '关闭' : 'Close'}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-shrink-0 border-b border-slate-100 px-2 py-2">
                  <button
                    type="button"
                    onClick={handleNewChat}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <FilePen className="h-4 w-4 flex-shrink-0" />
                    {t('ai.panel.newChat')}
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 space-y-0.5">{chatListItems}</div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 删除对话确认弹窗 */}
      <Dialog open={deleteConfirmChatId !== null} onOpenChange={(open) => !open && setDeleteConfirmChatId(null)}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>{t('ai.panel.deleteChatConfirm')}</DialogTitle>
            <DialogDescription>{t('ai.panel.deleteChatConfirmDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteConfirmChatId(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmChatId && handleDeleteChatConfirm(deleteConfirmChatId)}
            >
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  return content;
}
