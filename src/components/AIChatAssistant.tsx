import { useState, useEffect, useRef } from 'react';
import { Course, Semester } from '../types';
import { Send, User, Bot, X, Loader2, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { AI_MODELS, getSavedModelId, saveModelId, getModelCode } from '../lib/aiModels';
import { loadSemesterDataSync } from '../lib/storage';

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

const API_KEY = 'sk-mbhnbpkmlsukyindhxjvqqcbvrmgfmvvnkonxbpybkmkphjv';
const API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
// AI聊天历史保存在设备本地，不按用户ID隔离，避免多人共享账号时冲突
// 这样每个设备/浏览器都有自己独立的AI聊天历史
const STORAGE_KEY = 'ai-chat-history-device-local';

export default function AIChatAssistant({ viewMode, courses, focusSemester }: AIChatAssistantProps) {
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

**重要能力说明：**
- 你可以使用联网搜索功能获取最新的教材、教学大纲、课程标准等官方信息
- 当用户询问需要基于教材或大纲的内容时，请主动搜索相关的最新官方资料
- 搜索后请基于真实、准确的官方信息来回答，并标注信息来源

请务必使用 Markdown 格式输出，利用加粗、列表、分级标题等方式让内容层次分明、易于阅读。

${context}`
      };

      // 准备 API 请求，包含历史记录（限制长度以免超出上下文）
      const historyToSend = newMessages.slice(-10); // 取最近10条

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: getModelCode(selectedModelId),
          messages: [systemPrompt, ...historyToSend],
          stream: true,
          temperature: 0.7,
          max_tokens: 2000
        })
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
                // 如果开始收到内容，说明思考阶段可能结束
                if (!hasReceivedContent && reasoningEndTime === null) {
                  reasoningEndTime = Date.now();
                }
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
      setMessages(prev => [...prev, { role: 'assistant', content: '抱歉，服务暂时出现了一点问题，请稍后再试。' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    if (window.confirm('确定要清空聊天记录吗？')) {
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
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                  <Bot className="text-white w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 text-sm">课程河流 AI 助手</h3>
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[10px] text-gray-500">正在感知当前上下文</span>
                  </div>
                </div>
              </div>
              <button 
                onClick={clearChat}
                className="p-2 hover:bg-gray-200/50 rounded-full transition-colors text-gray-400 hover:text-red-500"
                title="清空记录"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {/* Model Selection */}
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-gray-600 font-medium whitespace-nowrap">AI模型:</label>
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
                {AI_MODELS.map((model) => (
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
                <h4 className="font-bold text-gray-700">你好！我是你的课程助手</h4>
                <p className="text-xs text-gray-500 leading-relaxed">
                  我可以帮你设计单元主题、建议跨学科联系，或者基于当前视图的数据为你提供优化方案。
                </p>
                <div className="grid grid-cols-1 gap-2 w-full">
                  <button 
                    onClick={() => setInput('基于这个学期，哪几个单元最适合做跨学科连接？请基于它们的核心概念（重叠或者互补）给出具体方案。')}
                    className="p-2 text-[12px] bg-white border border-gray-200 rounded-lg text-left hover:border-blue-400 hover:text-blue-600 transition-all shadow-sm"
                  >
                    💡 设计跨学科学习体验...
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
                              <span>思考过程</span>
                              {msg.reasoningTime !== undefined && msg.reasoningTime > 0 && (
                                <span className="ml-1 text-gray-400">(思考了 {msg.reasoningTime} 秒)</span>
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
                          思考了 {msg.reasoningTime} 秒
                        </div>
                      )}
                      
                      {/* 主要内容 */}
                      <div className="markdown-content">
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => <p className="mb-1 last:mb-0 leading-relaxed">{children}</p>,
                            ul: ({ children }) => <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>,
                            li: ({ children }) => <li className="leading-relaxed">{children}</li>,
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
                placeholder="问问 AI 助手..."
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
            <p className="text-[10px] text-gray-400 text-center mt-2">
              Powered by SiliconFlow {AI_MODELS.find(m => m.id === selectedModelId)?.name || 'AI'}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
