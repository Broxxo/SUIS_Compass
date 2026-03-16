/**
 * 统一 SUIS AI 面板：从主界面（SUIS AI 格）或子应用顶栏打开，Gemini 风格布局。
 * 左侧可收缩对话历史 + 模型选择，主区空状态居中问候 + 输入框，有对话时输入框在底部。
 * 输入栏左侧：上传、模式、上下文选择（第三项）。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import {
  useAIContext,
  buildBasicCurriculumPayload,
  type AIScreenId,
  type CurriculumRoadmapPayload,
} from '../contexts/AIContext';
import { Course } from '../types';
import { loadSemesterDataSync } from '../lib/storage';
import { AI_MODELS, getSavedModelId, saveModelId, getModelCode } from '../lib/aiModels';
import { getApiUrl, getAuthHeaders } from '../lib/api';
import {
  Send,
  User,
  Bot,
  ArrowLeft,
  Loader2,
  Paperclip,
  Globe,
  ChevronDown,
  FilePen,
  X,
  Menu,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';

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

function buildContextString(screenId: AIScreenId, payload: Record<string, unknown>): string {
  if (!screenId || screenId === 'hub') {
    return '当前无特定课程或学生画像等应用上下文。用户可能从 SUIS AI 主入口直接发起对话，你需要根据提问内容，在协和双语学校真实教学与校园场景下进行理解与回答。';
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
}

export default function AIPanel({ fullScreen: _fullScreen, fromHub, onClose }: AIPanelProps) {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { screenId, setScreenId, contextPayload, setContextPayload } = useAIContext();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
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
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [deleteConfirmChatId, setDeleteConfirmChatId] = useState<string | null>(null);
  const [expandedReasoning, setExpandedReasoning] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const displayName = user?.displayName || user?.username || (language === 'zh' ? '用户' : 'User');
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
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const handleNewChat = () => {
    setCurrentChatId(null);
    setMessages([]);
    setContextMenuOpen(false);
    setSidebarCollapsed(true);
  };

  const handleSelectChat = (id: string) => {
    setCurrentChatId(id);
    loadMessagesFor(id);
    setSidebarCollapsed(true);
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
    setDeleteConfirmChatId(chatId);
  };

  const handleContextSelect = (id: AIScreenId) => {
    setScreenId(id);
    if (id === 'curriculum-roadmap') {
      setContextPayload(buildBasicCurriculumPayload());
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

    const context = buildContextString(screenId, contextPayload as Record<string, unknown>);
    const systemBase = !screenId || screenId === 'hub' ? SYSTEM_PROMPT_GENERAL : SYSTEM_PROMPT_COURSE;
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
          : t('ai.panel.contextAssistant');
  const hasContext = screenId !== null && screenId !== 'hub';

  const content = (
    <div className="flex flex-col h-full bg-white">
      {/* Top bar: 返回（左）+ SUIS AI（中）+ 占位（右） */}
      <div className="flex-shrink-0 h-14 border-b border-slate-200 grid grid-cols-3 items-center px-4">
        <div className="flex justify-start">
          {fromHub && (
            <Button variant="outline" size="icon" onClick={onClose} className="h-9 w-9 rounded-lg" title={t('ai.panel.back')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
        </div>
        <span className="font-semibold text-slate-800 text-center">SUIS AI</span>
        <div className="flex justify-end">
          {!fromHub && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-9 w-9 rounded-lg text-slate-500 hover:text-slate-700"
              title={isZh ? '关闭' : 'Close'}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 relative">
        {/* 抽屉打开时的遮罩，点击关闭；过渡与抽屉一致，主界面不参与布局 */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setSidebarCollapsed(true)}
          onKeyDown={(e) => e.key === 'Enter' && setSidebarCollapsed(true)}
          className={`fixed inset-0 top-14 z-20 bg-black/20 transition-opacity duration-200 ${
            sidebarCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
          aria-label="关闭侧边栏"
          aria-hidden={sidebarCollapsed}
        />
        {/* 左侧抽屉：始终 fixed + transform 滑入滑出，主界面保持不动 */}
        <aside
          className={`fixed left-0 top-14 bottom-0 z-30 w-[72%] max-w-[280px] sm:max-w-[320px] shadow-xl border-r border-slate-200 bg-white flex flex-col transition-transform duration-200 ease-out ${
            sidebarCollapsed ? '-translate-x-full pointer-events-none' : 'translate-x-0'
          }`}
          aria-hidden={sidebarCollapsed}
        >
          {/* 顶行：新聊天（左）+ 关闭（右），无分隔线 */}
          <div className="flex items-center justify-between gap-2 px-2 py-2 flex-shrink-0">
            <button
              type="button"
              onClick={handleNewChat}
              className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-200/80 text-sm font-medium text-slate-700"
            >
              <FilePen className="h-4 w-4 flex-shrink-0" />
              {t('ai.panel.newChat')}
            </button>
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              className="p-2 rounded-lg hover:bg-slate-200 text-slate-600"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="px-3 pb-2 text-xs font-medium text-slate-500 flex-shrink-0">{t('ai.panel.chats')}</div>
          <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5 min-h-0">
            {chatList.map((c) => (
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
            ))}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* 主内容区左上角：菜单按钮 + 模型选择（参考 Gemini） */}
          <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"
              aria-label={isZh ? '打开菜单' : 'Open menu'}
              title={isZh ? '打开对话与设置' : 'Open chats & settings'}
            >
              <Menu className="h-5 w-5" />
            </button>
            <select
              value={selectedModelId}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedModelId(v);
                saveModelId(v);
              }}
              className="text-sm font-medium text-slate-700 bg-transparent border-0 py-1 pr-6 focus:ring-0 focus:outline-none cursor-pointer appearance-none"
              disabled={isLoading}
            >
              {AI_MODELS.filter((m) => m.kind !== 'image').map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <ChevronDown className="h-4 w-4 text-slate-500 -ml-5 pointer-events-none" aria-hidden />
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
                            <button type="button" disabled className="w-full px-3 py-2 text-left text-sm text-slate-400 cursor-not-allowed">{t('ai.panel.contextStudent')}</button>
                            <button type="button" disabled className="w-full px-3 py-2 text-left text-sm text-slate-400 cursor-not-allowed">{t('ai.panel.contextAssistant')}</button>
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
                            <ReactMarkdown
                              components={{
                                p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                                ul: ({ children }) => <ul className="list-disc pl-4 mb-1">{children}</ul>,
                                ol: ({ children }) => <ol className="list-decimal pl-4 mb-1">{children}</ol>,
                              }}
                            >
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
                            <button type="button" disabled className="w-full px-3 py-2 text-left text-sm text-slate-400 cursor-not-allowed">{t('ai.panel.contextStudent')}</button>
                            <button type="button" disabled className="w-full px-3 py-2 text-left text-sm text-slate-400 cursor-not-allowed">{t('ai.panel.contextAssistant')}</button>
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
