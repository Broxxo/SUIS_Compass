import { useState, useEffect, useRef } from 'react';
import { Course, Semester } from '../types';
import { Send, User, Bot, X, Loader2, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { aiMarkdownComponents, aiRemarkPlugins } from './aiMarkdown';
import { AI_MODELS, getSavedModelId, saveModelId, getModelCode } from '../lib/aiModels';
import { loadSemesterDataSync, loadKeyConceptsSync } from '../lib/storage';
import { getApiUrl, getAuthHeaders } from '../lib/api';
import { useLanguage } from '../contexts/LanguageContext';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoningContent?: string; // 思考过程内容
  reasoningTime?: number; // 思考时间（秒）
}

interface AIChatAssistantProps {
  viewMode: 'overview' | 'focus';
  courses: Course[];
  focusSemester: Semester;
}

// AI 请求经后端代理，密钥在服务端；聊天历史保存在设备本地
// 这样每个设备/浏览器都有自己独立的AI聊天历史
const STORAGE_KEY = 'ai-chat-history-device-local';

export default function AIChatAssistant({ viewMode, courses, focusSemester }: AIChatAssistantProps) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string>(getSavedModelId());
  const [expandedReasoning, setExpandedReasoning] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // 加载历史记录
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load chat history', e);
      }
    }
  }, []);

  // 保存历史记录
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    }
  }, [messages]);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // 采集当前上下文数据
  const gatherContext = (): string => {
    let context = `当前正在使用的课程规划应用上下文：\n`;
    context += `当前视图：${viewMode === 'overview' ? '整体视图' : '聚焦视图'}\n`;

    // 读取全局概念库
    const globalKeyConcepts = loadKeyConceptsSync();
    if (globalKeyConcepts.length > 0) {
      context += `\n全局关键概念库（可用于跨学科设计）：\n`;
      context += globalKeyConcepts.map(c => `- ${c}`).join('\n');
      context += `\n\n`;
    }

    if (viewMode === 'focus') {
      context += `当前聚焦学期：G${focusSemester.grade} ${focusSemester.semester}\n`;
      context += `该学期课程内容：\n`;
      
      courses.forEach(course => {
        // 使用 loadSemesterData 函数，自动使用当前用户的存储键
        const data = loadSemesterDataSync(course.id, focusSemester.grade, focusSemester.semester);
        if (data && data.units && data.units.length > 0) {
          context += `- 【${course.name}】：\n`;
          data.units.sort((a, b) => a.order - b.order).forEach(unit => {
            context += `  * Unit ${unit.order + 1}: ${unit.title} (周次: ${unit.week}, 关键概念: ${unit.keyConcepts.join(', ')})\n`;
            context += `    核心内容: ${unit.focus}\n`;
          });
        }
      });
    } else {
      context += `已有课程列表：${courses.map(c => c.name).join(', ')}\n`;
      context += `(整体视图包含跨度 G1-G9 的完整课程河流)\n`;
    }

    return context;
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const context = gatherContext();
      const systemPrompt: Message = {
        role: 'system',
        content: `你是一个专业的课程规划 AI 助手，名为"课程河流智能体"。你的目标是辅助教师进行课程设计、跨学科活动策划和教学内容优化。你可以看到用户当前的课程数据上下文，并据此给出精准建议。

**跨学科学习（IDL）核心理念：**
- 跨学科学习的核心是创造性地解决真实问题。学科学习与跨学科学习相互成就，学科是地基。
- 跨学科不是"学科+学科"，而是"问题+工具"——一种不惧未知、敢于试错的问题解决思维。学科知识边界模糊，一切知识为我所用。
- IDL 教学追求"把真实思维带进课堂"：只要学生在处理模拟任务时用的是真实的学科工具、做的是真实的逻辑推演，就是优秀的跨学科学习。

**跨学科设计的数量与合理性（务必遵守）：**
- 先反思：这个主题/情境是否真的需要这么多学科？不要为追求"覆盖更多学科"而堆砌学科，避免形式主义。
- 少而精优于多而泛：参与学科以 3 个左右为佳，具体根据项目与情境的真实需要来定，可多可少；配合得当、逻辑紧密比堆砌学科数量更有意义。
- 在「参与单元」中只列出真正参与、有明确角色与贡献的学科。

**跨学科单元设计框架（生成跨学科学习设计时，请严格按此模版输出）：**
1. **参与单元 Subjects Involved**：列出涉及的学科及各自角色
2. **单元名称 Unit Name**：简洁、体现跨学科主题
3. **大概念 Key Concepts & Conceptual Understanding**：跨学科的大概念与概念理解
4. **情境 & 驱动问题 Context & Driving Question**：真实情境或驱动问题
5. **单元目标 Unit Objectives (KUD)**：Know / Understand / Do
6. **单元评价 Unit Assessment**：评价方式与标准
7. **课时安排 Lesson Sequence (Including students activities)**：每课时的活动安排
8. **教学资源 Resources**：所需资源
9. **反思 Reflection**：可留白供教师填写

**标题与语言要求**：若用户要求以英文设计/输出，则整段回复（含所有标题与正文）必须全部使用英文，不得出现中文；模块标题仅用英文（如 ## Subjects Involved, ## Unit Name）。若用户要求中文或双语，则每个模块的标题须为「中文 + 英文」双语（如 ## 参与单元 Subjects Involved）。

**重要能力说明：**
- 你可以使用联网搜索功能获取最新的教材、教学大纲、课程标准等官方信息
- 当用户询问需要基于教材或大纲的内容时，请主动搜索相关的最新官方资料
- 搜索后请基于真实、准确的官方信息来回答，并标注信息来源

请务必使用 Markdown 格式输出，利用加粗、列表、分级标题等方式让内容层次分明、易于阅读。

${context}`
      };

      // 准备 API 请求，包含历史记录（限制长度以免超出上下文）
      const historyToSend = newMessages.slice(-10); // 取最近10条

      const response = await fetch(getApiUrl('/api/ai/chat'), {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          model: getModelCode(selectedModelId),
          messages: [systemPrompt, ...historyToSend],
          stream: true,
          temperature: 0.7,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) throw new Error('API Request failed');

      // 处理流式输出
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let reasoningContent = '';
      const reasoningStartTime = Date.now();
      let reasoningEndTime: number | null = null;
      let hasReceivedReasoning = false;
      let hasReceivedContent = false;

      setMessages(prev => [...prev, { role: 'assistant', content: '', reasoningContent: '' }]);

      while (true) {
        const { done, value } = await reader!.read();
        if (done) {
          // 如果还没有收到内容，说明可能只有思考过程
          if (!reasoningEndTime) {
            reasoningEndTime = Date.now();
          }
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              if (!reasoningEndTime) {
                reasoningEndTime = Date.now();
              }
              continue;
            }
            try {
              const json = JSON.parse(data);
              const choice = json.choices?.[0];
              if (!choice) continue;

              // 提取内容
              const delta = choice.delta || {};
              const content = delta.content || '';
              const reasoning = delta.reasoning_content || '';

              // 更新内容
              if (content) {
                assistantContent += content;
                hasReceivedContent = true;
              }
              if (reasoning) {
                reasoningContent += reasoning;
                hasReceivedReasoning = true;
              }

              // 检查是否完成思考
              if (choice.finish_reason) {
                if (!reasoningEndTime) {
                  reasoningEndTime = Date.now();
                }
              }

              // 计算当前思考时间
              const currentTime = reasoningEndTime || Date.now();
              const reasoningTime = Math.round((currentTime - reasoningStartTime) / 1000);

              setMessages(prev => {
                const last = prev[prev.length - 1];
                return [...prev.slice(0, -1), { 
                  ...last, 
                  content: assistantContent,
                  reasoningContent: reasoningContent || undefined,
                  reasoningTime: hasReceivedReasoning || hasReceivedContent ? reasoningTime : undefined
                }];
              });
            } catch (e) {
              console.error('Failed to parse stream data:', e);
            }
          }
        }
      }

      // 最终更新，确保思考时间正确
      const finalReasoningTime = reasoningEndTime 
        ? Math.round((reasoningEndTime - reasoningStartTime) / 1000)
        : Math.round((Date.now() - reasoningStartTime) / 1000);
      
      setMessages(prev => {
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), { 
          ...last, 
          reasoningContent: reasoningContent || undefined,
          reasoningTime: hasReceivedReasoning || hasReceivedContent ? finalReasoningTime : undefined
        }];
      });
    } catch (error) {
      console.error('AI Chat Error:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: t('ai.assistant.errorMessage') }]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    if (window.confirm(t('ai.assistant.clearConfirm'))) {
      setMessages([]);
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  return (
    <>
      {/* AI Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-2xl z-[200] flex items-center justify-center transition-all duration-300 ${
          isOpen ? 'bg-gray-800 scale-90' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:scale-110'
        }`}
      >
        {isOpen ? (
          <X className="text-white w-6 h-6" />
        ) : (
          <span className="text-white font-bold text-lg tracking-wider animate-pulse">AI</span>
        )}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 w-[530px] h-[650px] z-[200] flex flex-col bg-white/80 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-bottom-4">
          {/* Header */}
          <div className="p-4 border-b border-gray-200/50 bg-gray-50/50">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                <Bot className="text-white w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-gray-800 text-sm">{t('ai.assistant.title')}</h3>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] text-gray-500">{t('ai.assistant.sensingContext')}</span>
                </div>
              </div>
            </div>
            {/* Model Selection */}
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-gray-600 font-medium whitespace-nowrap">{t('ai.assistant.modelLabel')}:</label>
              <select
                value={selectedModelId}
                onChange={(e) => {
                  const newModelId = e.target.value;
                  setSelectedModelId(newModelId);
                  saveModelId(newModelId);
                }}
                className="flex-1 px-2 py-1.5 text-xs bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                disabled={isLoading}
              >
                {AI_MODELS.filter((m) => m.kind !== 'image').map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Messages List */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-transparent">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
                <div className="w-16 h-16 rounded-3xl bg-blue-100 flex items-center justify-center mb-2">
                  <Bot className="text-blue-600 w-10 h-10" />
                </div>
                <h4 className="font-bold text-gray-700">{t('ai.assistant.greeting')}</h4>
                <p className="text-xs text-gray-500 leading-relaxed">
                  {t('ai.assistant.greetingDesc')}
                </p>
                <div className="grid grid-cols-1 gap-2 w-full">
                  <button 
                    onClick={() => setInput('基于这个学期，哪几个单元最适合做跨学科连接？请先评估：真正适合做跨学科锚点的情境或驱动问题是什么，参与学科以 3 个左右为佳，具体根据项目需要可多可少，不必追求覆盖更多学科。再基于核心概念（重叠或互补）识别锚点，按 9 项跨学科单元设计框架生成完整设计方案，每个模块标题为双语（中文 + 英文）。')}
                    className="p-2 text-[12px] bg-white border border-gray-200 rounded-lg text-left hover:border-blue-400 hover:text-blue-600 transition-all shadow-sm"
                  >
                    💡 {t('ai.assistant.promptIdlZh')}
                  </button>
                  <button 
                    onClick={() => setInput('Based on this semester\'s units, which units are most suitable for interdisciplinary connections? First assess: what context or driving question genuinely needs interdisciplinary work? Around 3 subjects is often ideal; adjust by project need—can be more or fewer. Prefer depth and fit over piling on subjects. Then identify anchor points from overlapping or complementary key concepts and generate a complete design following the 9-section framework. IMPORTANT: Your entire response must be in English only—all headings, body text, and content. Do not use Chinese.')}
                    className="p-2 text-[12px] bg-white border border-gray-200 rounded-lg text-left hover:border-blue-400 hover:text-blue-600 transition-all shadow-sm"
                  >
                    💡 {t('ai.assistant.promptIdlEn')}
                  </button>
                </div>
              </div>
            )}
            
            {messages.map((msg, index) => {
              const isExpanded = expandedReasoning.has(index);
              const hasReasoning = msg.reasoningContent && msg.reasoningContent.trim().length > 0;
              
              return (
                <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                      msg.role === 'user' ? 'bg-gray-200' : 'bg-blue-100'
                    }`}>
                      {msg.role === 'user' ? <User className="w-4 h-4 text-gray-600" /> : <Bot className="w-4 h-4 text-blue-600" />}
                    </div>
                    <div className={`p-3 rounded-2xl text-[13px] shadow-sm ${
                      msg.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-tr-none' 
                        : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'
                    }`}>
                      {/* 思考过程（可展开/折叠） */}
                      {hasReasoning && (
                        <div className="mb-2 border-t border-gray-200 pt-2">
                          <button
                            onClick={() => {
                              const newExpanded = new Set(expandedReasoning);
                              if (isExpanded) {
                                newExpanded.delete(index);
                              } else {
                                newExpanded.add(index);
                              }
                              setExpandedReasoning(newExpanded);
                            }}
                            className="w-full flex items-center justify-between text-[11px] text-gray-500 hover:text-gray-700 transition-colors py-1"
                          >
                            <span className="flex items-center gap-1">
                              {isExpanded ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                              <span>{t('ai.assistant.reasoning')}</span>
                              {msg.reasoningTime !== undefined && msg.reasoningTime > 0 && (
                                <span className="ml-1 text-gray-400">({t('ai.assistant.reasoningSeconds').replace('{n}', String(msg.reasoningTime))})</span>
                              )}
                            </span>
                            {!isExpanded && (
                              <span className="text-gray-400 truncate max-w-[200px] text-[10px]">
                                {msg.reasoningContent!.substring(0, 50)}...
                              </span>
                            )}
                          </button>
                          {isExpanded && (
                            <div className="mt-2 p-2 bg-gray-50 rounded-lg border border-gray-200 max-h-[200px] overflow-y-auto">
                              <div className="text-[11px] text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">
                                {msg.reasoningContent}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* 思考时间（如果没有思考内容，也显示时间） */}
                      {!hasReasoning && msg.reasoningTime !== undefined && msg.reasoningTime > 0 && (
                        <div className="mb-2 text-[10px] text-gray-400 border-t border-gray-100 pt-2">
                          {t('ai.assistant.reasoningSeconds').replace('{n}', String(msg.reasoningTime))}
                        </div>
                      )}
                      
                      {/* 主要内容 */}
                      <div className="markdown-content">
                        <ReactMarkdown
                          remarkPlugins={aiRemarkPlugins}
                          components={{
                            ...aiMarkdownComponents,
                            strong: ({ children }) => (
                              <strong className={`font-bold ${msg.role === 'user' ? 'text-white underline decoration-blue-300' : 'text-blue-700'}`}>
                                {children}
                              </strong>
                            ),
                            code: ({ children }) => (
                              <code className={`px-1 rounded font-mono text-[11px] ${
                                msg.role === 'user' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-pink-600'
                              }`}>
                                {children}
                              </code>
                            ),
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
                <div className="max-w-[85%] flex gap-2">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="p-3 rounded-2xl bg-white border border-gray-100 rounded-tl-none shadow-sm">
                    <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                  </div>
                </div>
              </div>
            )}

            {/* 生成结束后在输出末尾显示跨学科设计快捷按钮，方便再次生成 */}
            {messages.length > 0 && !isLoading && messages[messages.length - 1]?.role === 'assistant' && (
              <div className="pt-2 pb-1">
                <p className="text-[11px] text-gray-500 mb-2">{t('ai.assistant.regenerateIdl')}</p>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={() => setInput('基于这个学期，哪几个单元最适合做跨学科连接？请先评估：真正适合做跨学科锚点的情境或驱动问题是什么，参与学科以 3 个左右为佳，具体根据项目需要可多可少，不必追求覆盖更多学科。再基于核心概念（重叠或互补）识别锚点，按 9 项跨学科单元设计框架生成完整设计方案，每个模块标题为双语（中文 + 英文）。')}
                    className="p-2 text-[12px] bg-white border border-gray-200 rounded-lg text-left hover:border-blue-400 hover:text-blue-600 transition-all shadow-sm"
                  >
                    💡 {t('ai.assistant.promptIdlZh')}
                  </button>
                  <button
                    onClick={() => setInput('Based on this semester\'s units, which units are most suitable for interdisciplinary connections? First assess: what context or driving question genuinely needs interdisciplinary work? Around 3 subjects is often ideal; adjust by project need—can be more or fewer. Prefer depth and fit over piling on subjects. Then identify anchor points from overlapping or complementary key concepts and generate a complete design following the 9-section framework. IMPORTANT: Your entire response must be in English only—all headings, body text, and content. Do not use Chinese.')}
                    className="p-2 text-[12px] bg-white border border-gray-200 rounded-lg text-left hover:border-blue-400 hover:text-blue-600 transition-all shadow-sm"
                  >
                    💡 {t('ai.assistant.promptIdlEn')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-gray-200/50 bg-gray-50/50">
            <div className="relative">
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
                className="w-full pl-4 pr-12 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none shadow-inner transition-all max-h-32"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all ${
                  input.trim() && !isLoading 
                    ? 'bg-blue-600 text-white hover:bg-blue-700' 
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center justify-between mt-2">
              <button
                onClick={clearChat}
                className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                title={t('ai.assistant.clearChatTitle')}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t('ai.assistant.clearChat')}</span>
              </button>
              <p className="text-[10px] text-gray-400">
                {t('ai.assistant.poweredBy')} {AI_MODELS.find(m => m.id === selectedModelId)?.name || 'AI'}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
