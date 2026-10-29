import React, { useEffect, useRef, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { requestJson, streamConversationMessage } from '../api.js';
import { startRun, appendRunStatus } from '../motionState.js';
import { useI18n } from '../i18nContext.js';
const WorkspaceChat = React.lazy(() => import('./WorkspaceChat.jsx').then(module => ({ default: module.WorkspaceChat })));

const identity = message => message;
export function SideChat({ parent, userId, ensureParent, documents, renderAttachment, scrubMessage = identity }) {
  const { t } = useI18n();
  const [conversation, setConversation] = useState(null);
  const [pending, setPending] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const controller = useRef(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const action = useRef(0);
  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    async function load() {
      try {
        if (!parent?.id) return;
        const result = await requestJson('/api/conversations', { signal: abort.signal });
        const latest = result.conversations.filter(item => item.parentId === parent.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        const next = latest || (await requestJson('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parentId: parent.id }), signal: abort.signal })).conversation;
        if (!abort.signal.aborted) setConversation(next);
      } catch (error) { if (!abort.signal.aborted) setNotice(error.message); }
      finally { if (!abort.signal.aborted) setLoading(false); }
    }
    load();
    return () => { alive.current = false; abort.abort(); controller.current?.abort(); };
  }, [parent?.id]);
  async function create() {
    if (lock.current) return;
    action.current += 1;
    lock.current = true;
    setLoading(true); setNotice('');
    try {
      const main = parent || await ensureParent();
      if (!main || !alive.current || !parent) return; // The new parent mounts its own card instance.
      const result = await requestJson('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parentId: main.id }) }, t);
      if (alive.current) setConversation(result.conversation);
    } catch (error) { if (alive.current) setNotice(error.message); }
    finally { lock.current = false; if (alive.current) setLoading(false); }
  }
  async function send(content) {
    if (!conversation || !content.trim() || lock.current) return;
    lock.current = true; action.current += 1;
    const abort = new AbortController(); controller.current = abort;
    let reconciled = false;
    const id = conversation.id;
    setNotice('');
    setConversation(current => ({ ...current, messages: [...current.messages, { id: `local-${Date.now()}`, role: 'user', kind: 'text', content, createdAt: new Date().toISOString() }] }));
    setPending(startRun(id, t('sideChat.thinking')));
    try {
      const done = await streamConversationMessage(id, content, { signal: abort.signal, onEvent: event => {
        if (!alive.current) return;
        if (event.type === 'status') setPending(current => appendRunStatus(current, event));
        if (event.type === 'message') setConversation(current => ({ ...current, messages: [...current.messages.filter(item => item.id !== event.message.id), event.message] }));
        if ((event.type === 'done' || event.type === 'error') && event.conversation) { reconciled = true; setConversation(event.conversation); }
      } }, t);
      if (alive.current && done) setConversation(done);
    } catch (error) {
      if (alive.current && error.name !== 'AbortError' && !reconciled) setNotice(error.message);
    } finally { controller.current = null; lock.current = false; if (alive.current) setPending(null); }
  }
  async function cancel() {
    const id = conversation?.id, generation = action.current;
    controller.current?.abort();
    setNotice(t('sideChat.stopped'));
    try {
      const result = await requestJson(`/api/conversations/${encodeURIComponent(id)}`, undefined, t);
      if (alive.current && generation === action.current) setConversation(result.conversation);
    } catch (error) { if (alive.current && generation === action.current) setNotice(error.message); }
  }
  return <div className="side-chat">
    <div className="side-chat-context"><span title={parent?.title}>{t('sideChat.from')} · {parent?.title || t('sideChat.newMainConversation')}</span><button type="button" title={t('sideChat.new')} aria-label={t('sideChat.new')} disabled={Boolean(pending) || loading} onClick={create}><MessageSquarePlus size={16} /></button></div>
    {loading ? <p role="status" className="side-chat-empty">{t('sideChat.opening')}</p> : conversation ? <React.Suspense fallback={<p role="status">{t('sideChat.opening')}</p>}><WorkspaceChat compact catalogUserId={userId} conversation={conversation} documents={documents} pending={pending} busy={Boolean(pending)} canCancel={Boolean(pending && controller.current)} onSend={send} onCancel={cancel} renderAttachment={renderAttachment} scrubMessage={scrubMessage} onSelectJob={() => setNotice('请在主会话中选择目标岗位。')} onOpenPreview={() => setNotice('旁聊产物保留在这段旁聊中，可直接下载。')} notice={notice} onDismissNotice={() => setNotice('')} /></React.Suspense> : <div className="side-chat-empty"><p role={notice ? 'alert' : undefined}>{notice || '从一段独立的小对话开始。'}</p><button type="button" onClick={create}>{parent ? '重试打开旁聊' : '开始旁聊'}</button></div>}
  </div>;
}
