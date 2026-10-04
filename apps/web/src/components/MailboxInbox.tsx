import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import AppTopBar from './AppTopBar';
import { Button } from './ui/button';
import { SegmentTabButton, SegmentTabGroup } from './ui/segment-tab-button';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { formatNavUserLabel } from '../lib/userDisplay';
import {
  createMailboxMessage,
  deleteMailboxMessage,
  fetchMailbox,
  replyToMailboxMessage,
  setMailboxStatus,
  updateMailboxMessage,
  type MailboxMessage,
  type MailboxStatus,
} from '../lib/mailboxApi';

function formatWhen(value: string, isZh: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(isZh ? 'zh-CN' : 'en-GB', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function progressLabel(status: MailboxStatus, isZh: boolean): string {
  if (status === 'done') return isZh ? '已完成' : 'Done';
  return isZh ? '处理中' : 'In progress';
}

function ReplyList({ message, isZh, emptyText }: { message: MailboxMessage; isZh: boolean; emptyText?: string }) {
  if (message.replies.length === 0) {
    return <p className="mt-3 text-sm text-slate-400">{emptyText ?? (isZh ? '还没有回复' : 'No replies yet')}</p>;
  }
  return (
    <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      {message.replies.map((item) => (
        <li key={item.id} className="rounded-md bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-500">
            <span className="font-medium text-slate-700">{item.authorName}</span>
            <span> · {formatWhen(item.createdAt, isZh)}</span>
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{item.body}</p>
        </li>
      ))}
    </ul>
  );
}

function StaffMailbox({
  isZh,
  userName,
  messages,
  setMessages,
  setError,
}: {
  isZh: boolean;
  userName: string;
  messages: MailboxMessage[];
  setMessages: Dispatch<SetStateAction<MailboxMessage[]>>;
  setError: (value: string) => void;
}) {
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const submit = () => {
    const text = body.trim();
    if (!text || busyId) return;
    setBusyId('new');
    setError('');
    createMailboxMessage(text)
      .then((message) => {
        setBody('');
        setComposing(false);
        setMessages((current) => [message, ...current.filter((item) => item.id !== message.id)]);
      })
      .catch((err: unknown) => {
        const code = err instanceof Error ? err.message : '';
        setError(code === 'too_long' ? (isZh ? '内容请控制在 2000 字以内' : 'Please keep it within 2000 characters') : isZh ? '提交没有成功，请再试一次' : 'Could not send. Please try again.');
      })
      .finally(() => setBusyId(null));
  };

  const save = (messageId: string) => {
    const text = editDraft.trim();
    if (!text || busyId) return;
    setBusyId(messageId);
    setError('');
    updateMailboxMessage(messageId, text)
      .then((saved) => {
        setMessages((current) => current.map((message) => (message.id === saved.id ? { ...message, body: saved.body } : message)));
        setEditingId(null);
      })
      .catch(() => setError(isZh ? '修改没有保存' : 'Could not save the change'))
      .finally(() => setBusyId(null));
  };

  const remove = (messageId: string) => {
    if (busyId) return;
    setBusyId(messageId);
    setError('');
    deleteMailboxMessage(messageId)
      .then(() => {
        setMessages((current) => current.filter((message) => message.id !== messageId));
        setConfirmDeleteId(null);
        setEditingId((current) => (current === messageId ? null : current));
      })
      .catch(() => setError(isZh ? '没有删掉' : 'Could not delete it'))
      .finally(() => setBusyId(null));
  };

  const comments = (message: MailboxMessage) => message.replies.filter((item) => item.fromAdmin);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {isZh ? '这里只显示你发起的意见，以及管理员的评论。' : 'Only the notes you started, and comments from administrators.'}
        </p>
        {composing ? null : (
          <Button type="button" size="sm" onClick={() => setComposing(true)}>
            {isZh ? '新建' : 'New'}
          </Button>
        )}
      </div>
      {composing ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-sm text-slate-600">{isZh ? `提交人：${userName}` : `From: ${userName}`}</p>
          <textarea
            value={body}
            maxLength={2000}
            rows={4}
            placeholder={isZh ? '写下对 Compass 的建议或意见' : 'A suggestion about Compass'}
            className="mt-3 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setComposing(false);
                setBody('');
              }}
            >
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button type="button" size="sm" disabled={busyId === 'new' || !body.trim()} onClick={submit}>
              {busyId === 'new' ? (isZh ? '提交中…' : 'Sending…') : isZh ? '提交' : 'Send'}
            </Button>
          </div>
        </div>
      ) : null}
      {messages.length === 0 ? (
        <p className="mt-6 text-sm text-slate-400">{isZh ? '还没有提交过意见' : 'You have not sent anything yet'}</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {messages.map((message) => (
            <li key={message.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-slate-900">
                  {isZh ? '进度' : 'Progress'}：{progressLabel(message.status, isZh)}
                </p>
                <p className="shrink-0 text-xs text-slate-400">{formatWhen(message.createdAt, isZh)}</p>
              </div>
              {editingId === message.id ? (
                <textarea
                  value={editDraft}
                  maxLength={2000}
                  rows={4}
                  className="mt-2 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onChange={(event) => setEditDraft(event.target.value)}
                />
              ) : (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">{message.body}</p>
              )}
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {editingId === message.id ? (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)}>
                      {isZh ? '取消' : 'Cancel'}
                    </Button>
                    <Button type="button" size="sm" disabled={busyId === message.id || !editDraft.trim()} onClick={() => save(message.id)}>
                      {isZh ? '保存' : 'Save'}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingId(message.id);
                      setEditDraft(message.body);
                      setConfirmDeleteId(null);
                    }}
                  >
                    {isZh ? '编辑' : 'Edit'}
                  </Button>
                )}
                {confirmDeleteId === message.id ? (
                  <Button type="button" variant="outline" size="sm" disabled={busyId === message.id} onClick={() => remove(message.id)}>
                    {isZh ? '确认删除' : 'Confirm delete'}
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDeleteId(message.id)}>
                    {isZh ? '删除' : 'Delete'}
                  </Button>
                )}
              </div>
              <p className="mt-3 text-xs font-medium text-slate-500">{isZh ? '管理员评论' : 'Administrator comments'}</p>
              <ReplyList message={{ ...message, replies: comments(message) }} isZh={isZh} emptyText={isZh ? '管理员还没有评论' : 'No administrator comment yet'} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AdminMailbox({
  isZh,
  messages,
  setMessages,
  setError,
}: {
  isZh: boolean;
  messages: MailboxMessage[];
  setMessages: Dispatch<SetStateAction<MailboxMessage[]>>;
  setError: (value: string) => void;
}) {
  const [filter, setFilter] = useState<MailboxStatus>('open');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const visible = messages.filter((message) => message.status === filter);
  const openCount = messages.filter((message) => message.status === 'open').length;
  const doneCount = messages.filter((message) => message.status === 'done').length;

  const reply = (messageId: string) => {
    const text = (drafts[messageId] ?? '').trim();
    if (!text || busyId) return;
    setBusyId(messageId);
    setError('');
    replyToMailboxMessage(messageId, text)
      .then((item) => {
        setDrafts((current) => ({ ...current, [messageId]: '' }));
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId ? { ...message, replies: [...message.replies, item] } : message,
          ),
        );
      })
      .catch(() => setError(isZh ? '回复没有发出去' : 'Could not send the reply'))
      .finally(() => setBusyId(null));
  };

  const remove = (messageId: string) => {
    if (busyId) return;
    setBusyId(messageId);
    setError('');
    deleteMailboxMessage(messageId)
      .then(() => {
        setMessages((current) => current.filter((message) => message.id !== messageId));
        setConfirmDeleteId(null);
      })
      .catch(() => setError(isZh ? '没有删掉' : 'Could not delete it'))
      .finally(() => setBusyId(null));
  };

  const mark = (messageId: string, status: MailboxStatus) => {
    if (busyId) return;
    setBusyId(messageId);
    setError('');
    setMailboxStatus(messageId, status)
      .then(() => {
        setMessages((current) => current.map((message) => (message.id === messageId ? { ...message, status } : message)));
      })
      .catch(() => setError(isZh ? '状态没有改成' : 'Could not update the status'))
      .finally(() => setBusyId(null));
  };

  return (
    <>
      <SegmentTabGroup>
        <SegmentTabButton grouped active={filter === 'open'} onClick={() => setFilter('open')}>
          {isZh ? `待处理 ${openCount}` : `Open ${openCount}`}
        </SegmentTabButton>
        <SegmentTabButton grouped active={filter === 'done'} onClick={() => setFilter('done')}>
          {isZh ? `已完成 ${doneCount}` : `Done ${doneCount}`}
        </SegmentTabButton>
      </SegmentTabGroup>
      {visible.length === 0 ? (
        <p className="mt-6 text-sm text-slate-400">{isZh ? '这里还没有来信' : 'Nothing in this list'}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {visible.map((message) => (
            <li key={message.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-slate-900">{message.authorName}</p>
                <p className="shrink-0 text-xs text-slate-400">{formatWhen(message.createdAt, isZh)}</p>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {isZh ? '进度' : 'Progress'}：{progressLabel(message.status, isZh)}
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">{message.body}</p>
              <ReplyList message={message} isZh={isZh} />
              <textarea
                value={drafts[message.id] ?? ''}
                maxLength={2000}
                rows={2}
                placeholder={isZh ? '回复提交人，只有对方和管理员能看到' : 'Reply to this person. Only they and administrators can see it.'}
                className="mt-3 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onChange={(event) => setDrafts((current) => ({ ...current, [message.id]: event.target.value }))}
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                {confirmDeleteId === message.id ? (
                  <Button type="button" variant="outline" size="sm" disabled={busyId === message.id} onClick={() => remove(message.id)}>
                    {isZh ? '确认删除' : 'Confirm delete'}
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled={busyId === message.id} onClick={() => setConfirmDeleteId(message.id)}>
                    {isZh ? '删除' : 'Delete'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busyId === message.id}
                  onClick={() => mark(message.id, message.status === 'done' ? 'open' : 'done')}
                >
                  {message.status === 'done' ? (isZh ? '标为未完成' : 'Mark open') : isZh ? '标记已完成' : 'Mark done'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={busyId === message.id || !(drafts[message.id] ?? '').trim()}
                  onClick={() => reply(message.id)}
                >
                  {isZh ? '回复' : 'Reply'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function MailboxInbox({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isZh = language === 'zh';
  const [viewerIsAdmin, setViewerIsAdmin] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<MailboxMessage[]>([]);
  const [error, setError] = useState('');
  const userName = user ? formatNavUserLabel(user) : '';

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchMailbox()
        .then((board) => {
          if (cancelled) return;
          setError('');
          setViewerIsAdmin(board.viewerIsAdmin);
          setMessages(board.messages);
        })
        .catch(() => {
          if (!cancelled) setError(isZh ? '来信暂时读不出来' : 'Could not load messages');
        });
    };
    load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isZh]);

  return (
    <div className="min-h-dvh w-full bg-slate-50 pt-[calc(var(--app-topbar-height)+0.5rem)] pb-8">
      <AppTopBar title={isZh ? '信箱' : 'Mailbox'} showBack onBack={onBack} />
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        {error ? <p className="mb-3 text-sm text-rose-600">{error}</p> : null}
        {viewerIsAdmin === null ? (
          <p className="text-sm text-slate-500">{isZh ? '正在读取信箱…' : 'Loading mailbox…'}</p>
        ) : viewerIsAdmin ? (
          <AdminMailbox isZh={isZh} messages={messages} setMessages={setMessages} setError={setError} />
        ) : (
          <StaffMailbox isZh={isZh} userName={userName} messages={messages} setMessages={setMessages} setError={setError} />
        )}
      </div>
    </div>
  );
}
