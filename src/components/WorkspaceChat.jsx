import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AssistantRuntimeProvider, useExternalStoreRuntime, ThreadPrimitive,
  MessagePrimitive, ComposerPrimitive, ActionBarPrimitive, useAui, useAuiState,
} from '@assistant-ui/react';
import { ArrowDown, ArrowUp, Bot, BriefcaseBusiness, Check, Copy, Download, FileText, Paperclip, Square, Upload } from 'lucide-react';
import { SafeMarkdown } from './SafeMarkdown.js';
import { MessageResult } from './ChatResultCards.jsx';
import { LoomiPet } from './LoomiPet.jsx';
import { promptText, toAssistantMessage, visibleMessages } from '../workspaceRuntime.js';
import { filterSkills, insertSkillCommand, skillCommandQuery } from '../skillMenu.js';
import { requestJson } from '../api.js';
import { Crossfade, MotionGroup, Presence, useComposerSize, usePresence } from '../motionHooks.jsx';
import { motionDuration, runTiming } from '../motionState.js';
import '../workspace.css';

const suggestions = [
  { eyebrow: 'ANALYSIS', label: '诊断简历', description: '基于目标岗位分析简历匹配度', prompt: '请帮我诊断简历，先核对已有资料。' },
  { eyebrow: 'DISCOVERY', label: '寻找岗位', description: '检索符合你背景的公开岗位', prompt: '我想找合适的岗位。' },
  { eyebrow: 'CUSTOMIZATION', label: '定制简历', description: '针对目标岗位优化经历表述', prompt: '我想根据目标岗位定制简历。' },
  { eyebrow: 'SIMULATION', label: '准备面试', description: '生成可能的追问与回答思路', prompt: '帮我准备目标岗位的面试。' },
];

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

export function WorkspaceChat({ conversation, documents, pending, busy, canCancel, onSend, onCancel, onAttach, onDropFiles, onSelectJob, onOpenPreview, renderAttachment, scrubMessage, notice, onDismissNotice, catalogUserId, compact = false }) {
  const messages = useMemo(() => visibleMessages(conversation).map(scrubMessage), [conversation, scrubMessage]);
  const runtime = useExternalStoreRuntime({
    messages, convertMessage: toAssistantMessage,
    isRunning: Boolean(pending && canCancel),
    isSendDisabled: busy,
    onNew: async message => { await onSend(promptText(message)); },
    onCancel: async () => { await onCancel(); },
  });
  const empty = messages.length === 0;
  const latestResumeId = messages.findLast(message => message.kind === 'resume')?.id;
  const [dragActive, setDragActive] = useState(false);
  const [dropAccepted, setDropAccepted] = useState(false);
  const dropTimer = useRef(null);
  const dragDepth = useRef(0);
  useEffect(() => {
    // Dropping outside the thread or Esc-cancelling the drag can leave the
    // enter/leave counter unbalanced; window-level drop closes the overlay.
    const reset = () => { dragDepth.current = 0; setDragActive(false); };
    // A missed drop on the sidebar or evidence panel would otherwise make the
    // browser navigate away to the raw file instead of staying in the workspace.
    const guard = event => { if (isFileDrag(event)) event.preventDefault(); };
    window.addEventListener('drop', reset);
    window.addEventListener('drop', guard);
    window.addEventListener('dragover', guard);
    return () => {
      clearTimeout(dropTimer.current);
      window.removeEventListener('drop', reset);
      window.removeEventListener('drop', guard);
      window.removeEventListener('dragover', guard);
    };
  }, []);
  const dragHandlers = {
    onDragEnter: event => { if (isFileDrag(event)) { dragDepth.current += 1; setDragActive(true); } },
    onDragOver: event => { if (isFileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } },
    onDragLeave: event => {
      if (!isFileDrag(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    },
    onDrop: event => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length) {
        setDropAccepted(true);
        clearTimeout(dropTimer.current);
        dropTimer.current = setTimeout(() => setDropAccepted(false), 160);
        onDropFiles?.(files);
      }
    },
  };
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="aui-thread" data-empty={empty} {...dragHandlers}>
        <ThreadPrimitive.Viewport className="aui-viewport" autoScroll aria-label="对话内容">
          <div className="aui-messages" role="log" aria-live="polite" aria-relevant="additions">
            {empty ? compact ? <div className="side-chat-empty"><h3>顺手问一句。</h3><p>沿用当前求职背景，消息只留在旁聊。</p></div> : <><Welcome hasResume={Boolean(documents?.length)} onAttach={onAttach} disabled={busy} /><Suggestions disabled={busy} /></> : null}
            <ThreadPrimitive.Messages>{({ message }) => {
              const careerMessage = message.metadata?.custom?.careerMessage;
              return <CareerMessage message={careerMessage} streaming={Boolean(pending)} conversation={conversation} documents={documents} latestResumeId={latestResumeId} onSelectJob={onSelectJob} onOpenPreview={onOpenPreview} renderAttachment={renderAttachment} />;
            }}</ThreadPrimitive.Messages>
            <AgentRunTrail pending={pending} canCancel={canCancel} onCancel={onCancel} />
            {pending && !messages.slice(messages.findLastIndex(item => item.role === 'user') + 1).some(message => message.role === 'assistant' && message.content?.trim()) ? <div className="aui-pending-skeleton" aria-hidden="true"><span /><span /><span /></div> : null}
          </div>
          {!empty ? <ThreadPrimitive.ScrollToBottom className="aui-scroll-bottom" aria-label="回到最新消息"><ArrowDown size={17} /></ThreadPrimitive.ScrollToBottom> : null}
        </ThreadPrimitive.Viewport>
        <div className="aui-composer-dock">
          <Presence visible={Boolean(notice)} className="notice-presence"><div className="notice-reveal"><div><div className="aui-notice" role="status"><span>{notice}</span><button type="button" onClick={onDismissNotice} aria-label="关闭提示">关闭</button></div></div></div></Presence>
          <Presence visible={Boolean(conversation?.context?.selectedJob)}><button type="button" className="aui-context-chip" onClick={onOpenPreview}><BriefcaseBusiness size={13} /><Crossfade identity={conversation?.context?.selectedJob?.id || conversation?.context?.selectedJob?.title}>当前目标 · {conversation?.context?.selectedJob?.title}</Crossfade></button></Presence>
          <CareerComposer key={conversation?.id || 'new'} busy={busy} canCancel={canCancel} onAttach={onAttach} catalogUserId={catalogUserId} compact={compact} />
          {!compact && <p className="aui-composer-hint">建议以你的真实经历为依据，重要信息请与原文核对。</p>}
        </div>
        {!compact && <LoomiPet pending={pending} lastMessage={messages.at(-1)} />}
        <Presence visible={dragActive || dropAccepted}><div className="aui-drop-overlay" data-accepted={dropAccepted} aria-hidden="true">
          <div className="aui-drop-card"><svg className="drop-dashes" aria-hidden="true"><rect /></svg><Upload size={22} strokeWidth={1.6} /><strong>松开鼠标，上传材料</strong><span>支持 PDF、DOCX、TXT、Markdown、JSON，最大 8MB</span></div>
        </div></Presence>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

export function AgentRunTrail({ pending, canCancel, onCancel }) {
  const { mounted, closing } = usePresence(Boolean(pending));
  const last = useRef(pending);
  if (pending) last.current = pending;
  const run = pending || last.current;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!pending) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [Boolean(pending), pending?.startedAt]);
  if (!mounted || !run) return null;
  const timing = runTiming(run, now);
  return <div className={closing ? 'aui-status-exit' : 'aui-status'} role={closing ? undefined : 'status'} aria-hidden={closing || undefined} data-closing={closing}>
    <ol className="agent-run-trail">{run.steps.map((step, index) => {
      const current = index === run.steps.length - 1;
      return <li key={`${step.at}-${index}`} data-current={current} style={{ '--enter-delay': `calc(var(--stagger) * ${Math.min(index, 7)})` }}>
        <span className="agent-step-circle" aria-hidden="true">{current ? <span className="aui-status-dot" /> : <><Check className="agent-step-check" size={12} /><span className="agent-step-ripple" /></>}</span>
        <span className="agent-step-label">{current && run.stopping ? run.label : step.label}</span>
        <span className="agent-step-duration" aria-live="off">{timing.steps[index]}S</span>
      </li>;
    })}</ol>
    <div className="agent-run-bar" aria-hidden="true"><span /></div>
    <div className="agent-run-footer"><span className="agent-elapsed" aria-live="off">STEP {run.steps.length} · {timing.total}S</span>
      {pending && canCancel ? <button type="button" className="agent-run-cancel" aria-label="停止当前任务" disabled={run.stopping || closing} onClick={onCancel}>{run.stopping ? '正在停止…' : 'CANCEL SESSION / 停止'}</button> : null}
    </div>
  </div>;
}

function Welcome({ hasResume, onAttach, disabled }) {
  return <section className="aui-welcome">
    <p className="aui-eyebrow">CAREER WORKSPACE · 你的求职工作区</p>
    <h1>下一步，我们一起准备。</h1>
    <p>{hasResume ? '简历已在档案里，从一个心仪的岗位或一个问题开始。' : '先上传一份简历，之后的分析、岗位匹配和面试准备都会基于它。'}</p>
    {hasResume ? null : <button type="button" className="aui-welcome-upload" onClick={onAttach} disabled={disabled}><Upload size={16} />上传简历<span>PDF · DOCX · TXT，也可拖入对话区</span></button>}
  </section>;
}

function Suggestions({ disabled }) {
  const aui = useAui();
  return <div className="aui-suggestions" aria-label="求职对话建议">{suggestions.map(({ eyebrow, label, description, prompt }, index) =>
    <button key={label} aria-label={label} style={{ '--enter-delay': `calc(var(--stagger) * ${index})` }} type="button" disabled={disabled} onClick={() => { aui.thread.composer().setText(prompt); document.querySelector('.aui-composer-input')?.focus(); }}><span className="suggestion-eyebrow">{eyebrow}</span><strong>{label}</strong><span className="suggestion-description">{description}</span></button>
  )}</div>;
}

function CareerComposer({ busy, canCancel, onAttach, catalogUserId, compact }) {
  const aui = useAui();
  const text = useAuiState(s => s.composer.isEditing ? s.composer.text : '');
  const input = useRef(null);
  const composing = useRef(false);
  useComposerSize(input, composing);
  const listId = useId();
  const [catalog, setCatalog] = useState({ status: 'loading', skills: [] });
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const [inserted, setInserted] = useState(false);
  useEffect(() => {
    if (!inserted) return;
    const timer = setTimeout(() => setInserted(false), motionDuration(getComputedStyle(document.documentElement).getPropertyValue('--dur-slow'), 380));
    return () => clearTimeout(timer);
  }, [inserted]);
  const query = skillCommandQuery(text, cursor);
  const matches = useMemo(() => query === null ? [] : filterSkills(catalog.skills, query), [catalog.skills, query]);
  const open = focused && !busy && !dismissed && query !== null;
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));
  useEffect(() => {
    if (!catalogUserId) {
      setCatalog({ status: 'unauthenticated', skills: [] });
      return;
    }
    const controller = new AbortController();
    setCatalog({ status: 'loading', skills: [] });
    requestJson('/api/skills', { signal: controller.signal, timeoutMs: 15_000 }).then(data => {
      if (!Array.isArray(data.skills)) throw new Error('Skill 目录格式无效');
      setCatalog({ status: 'ready', skills: data.skills });
    }).catch(error => {
      if (!controller.signal.aborted) setCatalog({ status: error.status === 401 ? 'unauthenticated' : 'error', skills: [] });
    });
    return () => controller.abort();
  }, [catalogUserId, catalogAttempt]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, listId, open]);
  const select = skill => {
    if (busy || composing.current) return;
    const next = insertSkillCommand(text, skill.name);
    aui.composer.setText(next);
    setInserted(true);
    setDismissed(true);
    const position = skill.name.length + 2;
    setCursor(position);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(position, position); });
  };
  const handleKeyDown = event => {
    // ComposerPrimitive composes this handler before its own submit handler and
    // respects preventDefault. Block IME Enter even on browsers using keyCode 229.
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
      if (event.key === 'Enter') event.preventDefault();
      return;
    }
    if (!open || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') { event.preventDefault(); setDismissed(true); }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      if (matches.length) setActive((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      // A pending/failed/unmatched command must not accidentally submit on Enter.
      if (event.key === 'Enter' || matches.length) event.preventDefault();
      if (matches.length) select(matches[activeIndex]);
    }
  };
  return <ComposerPrimitive.Root className={`aui-composer${inserted ? ' skill-inserted' : ''}`} onAnimationEnd={event => { if (event.target === event.currentTarget) setInserted(false); }}>
    <Presence visible={open}><div className="aui-skill-menu">
      <div className="aui-skill-menu-heading"><span>可用 Skills</span><span>↑↓ 选择 · Enter / Tab 确认</span></div>
      <MotionGroup id={listId} role="listbox" aria-label="可用 Skills" className="aui-skill-options" selector="button[role=option]" activeKey={activeIndex}>
        {matches.map((skill, index) => <button key={skill.name} style={{ '--enter-delay': `calc(var(--stagger) * ${Math.min(index, 7)})` }} id={`${listId}-${index}`} type="button" role="option" aria-selected={index === activeIndex} tabIndex={-1} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => select(skill)}>
          <span className="aui-skill-label">{skill.label || skill.name}<code>/{skill.name}</code></span><span className="aui-skill-description">{skill.description}</span>
        </button>)}
      </MotionGroup>
      {catalog.status === 'loading' ? <p className="aui-skill-loading" role="status">正在加载 Skills…</p> : ['error', 'unauthenticated'].includes(catalog.status) ? <p role="alert">
        {catalog.status === 'unauthenticated' ? '请先登录，登录后可加载 Skills。' : 'Skills 加载失败，请重试。'}
        {catalogUserId ? <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { setCatalogAttempt(attempt => attempt + 1); input.current?.focus(); }}>重试加载 Skills</button> : null}
      </p> : !matches.length ? <p role="status">没有匹配的 Skill。</p> : null}
    </div></Presence>
    <ComposerPrimitive.Input ref={input} disabled={busy} className="aui-composer-input" placeholder={compact ? '在旁聊中提问…' : '今天想推进哪一步？输入 / 选择 Skill'} aria-label={compact ? '给旁聊发消息' : '给 Loomi 发消息'} aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open && matches.length ? `${listId}-${activeIndex}` : undefined} minRows={1} maxRows={7} submitMode="enter" addAttachmentOnPaste={false} cancelOnEscape={false}
      onChange={event => {
        // Recover when an IME drops compositionend but resumes ordinary input,
        // matching assistant-ui's own composition recovery without losing focus.
        if (event.nativeEvent.isComposing === false) composing.current = false;
        setCursor(event.target.selectionStart);
        setDismissed(false);
      }}
      onSelect={event => setCursor(event.target.selectionStart)} onFocus={() => setFocused(true)} onBlur={() => { composing.current = false; setFocused(false); }} onKeyDown={handleKeyDown}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={event => { composing.current = false; setCursor(event.target.selectionStart); }} />
    <div className="aui-composer-toolbar">
      <div className="aui-composer-tools">
        {!compact && <button type="button" className="aui-attach" onClick={onAttach} disabled={busy} aria-label="上传简历" title="上传简历 · 也可直接拖入对话区 · PDF、DOCX、TXT、MD、JSON，最大 8MB"><Paperclip size={19} /></button>}
        <span>{compact ? '旁聊' : '简历与岗位助手'}</span>
      </div>
      <span className="aui-submit-slot" data-running={canCancel}>
      {canCancel ? <ComposerPrimitive.Cancel className="aui-stop" aria-label="停止生成" title="停止生成"><SubmitIcon running /></ComposerPrimitive.Cancel>
        : <ComposerPrimitive.Send className="aui-send" aria-label="发送消息" title="发送消息"><SubmitIcon /></ComposerPrimitive.Send>}
      <kbd className="shortcut-hint">Enter</kbd></span>
    </div>
  </ComposerPrimitive.Root>;
}

function SubmitIcon({ running = false }) {
  return <span className="aui-submit-icons" aria-hidden="true"><ArrowUp className={running ? 'icon-out' : 'icon-in'} size={19} /><Square className={running ? 'icon-in' : 'icon-out'} size={15} fill="currentColor" /></span>;
}

function CareerMessage({ message, streaming, conversation, documents, latestResumeId, onSelectJob, onOpenPreview, renderAttachment }) {
  const isCopied = useAuiState(s => s.message.isCopied);
  if (!message) return null;
  const assistant = message.role === 'assistant';
  const currentResume = message.id === latestResumeId && Boolean(conversation?.context?.variant || conversation?.context?.formalResume);
  return <MessagePrimitive.Root className={`aui-message ${assistant ? 'assistant' : 'user'}`} data-kind={message.kind} data-message-id={message.id}>
      {assistant ? <span className="aui-assistant-avatar" aria-hidden="true"><Bot size={17} strokeWidth={1.5} /></span> : null}
    <div className="aui-message-body">
      {message.kind !== 'attachment' ? <div className={assistant && streaming ? 'aui-stream-text' : undefined} key={assistant && streaming ? message.content : 'text'}><SafeMarkdown text={message.content} /></div> : null}
      {message.kind === 'attachment' ? renderAttachment(message, documents) : null}
      {message.kind === 'resume' && message.data?.variant ? <div className="aui-artifact">
        <FileText size={24} strokeWidth={1.4} /><div><strong>{message.data.variant.targetTitle || message.data.variant.title || '岗位版简历'}</strong><p>{currentResume ? '优化稿已准备好 · 可预览与下载' : '历史版本 · 当前优化稿请在资料面板查看'}</p></div>
        {currentResume ? <button type="button" onClick={onOpenPreview}>打开优化稿</button> : null}
        {currentResume ? <div className="aui-artifact-downloads"><a href={`/api/conversations/${encodeURIComponent(conversation.id)}/resume.pdf`}><Download size={13} />PDF</a><a href={`/api/conversations/${encodeURIComponent(conversation.id)}/resume.docx`}><Download size={13} />DOCX</a></div> : null}
      </div> : <MessageResult message={message} context={conversation?.context} onSelectJob={onSelectJob} />}
    </div>
    {assistant ? <ActionBarPrimitive.Root className="aui-message-actions" autohide="never">
      <ActionBarPrimitive.Copy data-copied={isCopied} aria-label={isCopied ? '已复制回复' : '复制回复'} title="复制回复"><span className="copy-icons"><Copy size={14} /><Check size={14} /></span></ActionBarPrimitive.Copy>
      {['diagnosis', 'resume', 'interview'].includes(message.kind) ? <button type="button" onClick={onOpenPreview}><FileText size={14} />查看资料</button> : null}
    </ActionBarPrimitive.Root> : null}
  </MessagePrimitive.Root>;
}
