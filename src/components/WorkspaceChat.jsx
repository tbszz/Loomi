import { useI18n } from '../i18nContext.js';
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

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

export function WorkspaceChat({ conversation, documents, pending, busy, canCancel, onSend, onCancel, onAttach, onDropFiles, onSelectJob, onOpenPreview, renderAttachment, scrubMessage, notice, onDismissNotice, catalogUserId }) {
  const { t } = useI18n();
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
        <ThreadPrimitive.Viewport className="aui-viewport" autoScroll aria-label={t("chat.conversation")}>
          <div className="aui-messages" role="log" aria-live="polite" aria-relevant="additions">
            {empty ? <><Welcome hasResume={Boolean(documents?.length)} onAttach={onAttach} disabled={busy} /><Suggestions disabled={busy} /></> : null}
            <ThreadPrimitive.Messages>{({ message }) => {
              const careerMessage = message.metadata?.custom?.careerMessage;
              return <CareerMessage message={careerMessage} streaming={Boolean(pending)} conversation={conversation} documents={documents} latestResumeId={latestResumeId} onSelectJob={onSelectJob} onOpenPreview={onOpenPreview} renderAttachment={renderAttachment} />;
            }}</ThreadPrimitive.Messages>
            <AgentRunTrail pending={pending} canCancel={canCancel} onCancel={onCancel} />
            {pending && !messages.slice(messages.findLastIndex(item => item.role === 'user') + 1).some(message => message.role === 'assistant' && message.content?.trim()) ? <div className="aui-pending-skeleton" aria-hidden="true"><span /><span /><span /></div> : null}
          </div>
          {!empty ? <ThreadPrimitive.ScrollToBottom className="aui-scroll-bottom" aria-label={t("chat.goToLatestMessage")}><ArrowDown size={17} /></ThreadPrimitive.ScrollToBottom> : null}
        </ThreadPrimitive.Viewport>
        <div className="aui-composer-dock">
          <Presence visible={Boolean(notice)} className="notice-presence"><div className="notice-reveal"><div><div className="aui-notice" role="status"><span>{notice}</span><button type="button" onClick={onDismissNotice} aria-label={t("chat.dismissNotice")}>{t("workspace.close")}</button></div></div></div></Presence>
          <Presence visible={Boolean(conversation?.context?.selectedJob)}><button type="button" className="aui-context-chip" onClick={onOpenPreview}><BriefcaseBusiness size={13} /><Crossfade identity={conversation?.context?.selectedJob?.id || conversation?.context?.selectedJob?.title}>{t("chat.currentTarget")}{conversation?.context?.selectedJob?.title}</Crossfade></button></Presence>
          <CareerComposer key={conversation?.id || 'new'} busy={busy} canCancel={canCancel} onAttach={onAttach} catalogUserId={catalogUserId} />
          <p className="aui-composer-hint">{t("chat.useYourRealExperienceAsTheBasis")}</p>
        </div>
        <LoomiPet pending={pending} lastMessage={messages.at(-1)} />
        <Presence visible={dragActive || dropAccepted}><div className="aui-drop-overlay" data-accepted={dropAccepted} aria-hidden="true">
          <div className="aui-drop-card"><svg className="drop-dashes" aria-hidden="true"><rect /></svg><Upload size={22} strokeWidth={1.6} /><strong>{t("chat.dropToUploadYourMaterials")}</strong><span>{t("chat.pdfDocxTxtMarkdownJsonUpTo")}</span></div>
        </div></Presence>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

export function AgentRunTrail({ pending, canCancel, onCancel }) {
  const { t } = useI18n();
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
        <span className="agent-step-duration" aria-live="off">{timing.steps[index]}{t("chat.seconds")}</span>
      </li>;
    })}</ol>
    <div className="agent-run-bar" aria-hidden="true"><span /></div>
    <div className="agent-run-footer"><span className="agent-elapsed" aria-live="off">{t("chat.step")} {run.steps.length} · {timing.total}{t("chat.seconds")}</span>
      {pending && canCancel ? <button type="button" className="agent-run-cancel" aria-label={t("chat.stopCurrentTask")} disabled={run.stopping || closing} onClick={onCancel}>{run.stopping ? t("workspace.stopping") : t("chat.cancelSession")}</button> : null}
    </div>
  </div>;
}

function Welcome({ hasResume, onAttach, disabled }) {
  const { t } = useI18n();
  return <section className="aui-welcome">
    <p className="aui-eyebrow">{t("chat.careerWorkspace")}</p>
    <h1>{t("chat.letSPrepareYourNextStep")}</h1>
    <p>{hasResume ? t("chat.yourResumeIsOnFileStartWith") : t("chat.uploadAResumeFirstAnalysisJobMatching")}</p>
    {hasResume ? null : <button type="button" className="aui-welcome-upload" onClick={onAttach} disabled={disabled}><Upload size={16} />{t("chat.uploadResume")}<span>{t("chat.pdfDocxTxtOrDropIntoThe")}</span></button>}
  </section>;
}

function Suggestions({ disabled }) {
  const { t } = useI18n();
  const suggestions = [
    { eyebrow: t("chat.analysis"), label: t("chat.analyzeResume"), description: t("chat.analyzeResumeFitForATargetJob"), prompt: t("chat.pleaseAnalyzeMyResumeAndCheckThe") },
    { eyebrow: t("chat.discovery"), label: t("chat.findJobs"), description: t("chat.searchPublicJobsThatMatchYourBackground"), prompt: t("chat.iWouldLikeToFindSuitableJobs") },
    { eyebrow: t("chat.customization"), label: t("chat.tailorResume"), description: t("chat.refineExperienceDescriptionsForYourTargetJob"), prompt: t("chat.iWouldLikeToTailorMyResume") },
    { eyebrow: t("chat.simulation"), label: t("chat.prepareForInterviews"), description: t("chat.prepareLikelyFollowUpsAndAnswerOutlines"), prompt: t("chat.helpMePrepareForMyTargetJob") },
  ];

  const aui = useAui();
  return <div className="aui-suggestions" aria-label={t("chat.careerConversationSuggestions")}>{suggestions.map(({ eyebrow, label, description, prompt }, index) =>
    <button key={label} aria-label={label} style={{ '--enter-delay': `calc(var(--stagger) * ${index})` }} type="button" disabled={disabled} onClick={() => { aui.thread.composer().setText(prompt); document.querySelector('.aui-composer-input')?.focus(); }}><span className="suggestion-eyebrow">{eyebrow}</span><strong>{label}</strong><span className="suggestion-description">{description}</span></button>
  )}</div>;
}

function CareerComposer({ busy, canCancel, onAttach, catalogUserId }) {
  const { t } = useI18n();
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
    requestJson('/api/skills', { signal: controller.signal, timeoutMs: 15_000 }, t).then(data => {
      if (!Array.isArray(data.skills)) throw new Error(t("chat.invalidSkillsCatalogFormat"));
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
      <div className="aui-skill-menu-heading"><span>{t("chat.availableSkills")}</span><span>{t("chat.chooseEnterTabConfirm")}</span></div>
      <MotionGroup id={listId} role="listbox" aria-label={t("chat.availableSkills")} className="aui-skill-options" selector="button[role=option]" activeKey={activeIndex}>
        {matches.map((skill, index) => <button key={skill.name} style={{ '--enter-delay': `calc(var(--stagger) * ${Math.min(index, 7)})` }} id={`${listId}-${index}`} type="button" role="option" aria-selected={index === activeIndex} tabIndex={-1} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => select(skill)}>
          <span className="aui-skill-label">{skill.label || skill.name}<code>/{skill.name}</code></span><span className="aui-skill-description">{skill.description}</span>
        </button>)}
      </MotionGroup>
      {catalog.status === 'loading' ? <p className="aui-skill-loading" role="status">{t("chat.loadingSkills")}</p> : ['error', 'unauthenticated'].includes(catalog.status) ? <p role="alert">
        {catalog.status === 'unauthenticated' ? t("chat.signInToLoadSkills") : t("chat.couldNotLoadSkillsTryAgain")}
        {catalogUserId ? <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { setCatalogAttempt(attempt => attempt + 1); input.current?.focus(); }}>{t("chat.retryLoadingSkills")}</button> : null}
      </p> : !matches.length ? <p role="status">{t("chat.noMatchingSkill")}</p> : null}
    </div></Presence>
    <ComposerPrimitive.Input ref={input} disabled={busy} className="aui-composer-input" placeholder={t("chat.whatSYourNextStepTypeTo")} aria-label={t("chat.messageResumeProtocol")} aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open && matches.length ? `${listId}-${activeIndex}` : undefined} minRows={1} maxRows={7} submitMode="enter" addAttachmentOnPaste={false} cancelOnEscape={false}
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
        <button type="button" className="aui-attach" onClick={onAttach} disabled={busy} aria-label={t("chat.uploadResume")} title={t("chat.uploadResumeOrDropIntoTheConversation")}><Paperclip size={19} /></button>
        <span>{t("chat.resumeJobAssistant")}</span>
      </div>
      <span className="aui-submit-slot" data-running={canCancel}>
      {canCancel ? <ComposerPrimitive.Cancel className="aui-stop" aria-label={t("chat.stopGenerating")} title={t("chat.stopGenerating")}><SubmitIcon running /></ComposerPrimitive.Cancel>
        : <ComposerPrimitive.Send className="aui-send" aria-label={t("chat.sendMessage")} title={t("chat.sendMessage")}><SubmitIcon /></ComposerPrimitive.Send>}
      <kbd className="shortcut-hint">Enter</kbd></span>
    </div>
  </ComposerPrimitive.Root>;
}

function SubmitIcon({ running = false }) {
  return <span className="aui-submit-icons" aria-hidden="true"><ArrowUp className={running ? 'icon-out' : 'icon-in'} size={19} /><Square className={running ? 'icon-in' : 'icon-out'} size={15} fill="currentColor" /></span>;
}

function CareerMessage({ message, streaming, conversation, documents, latestResumeId, onSelectJob, onOpenPreview, renderAttachment }) {
  const { t } = useI18n();
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
        <FileText size={24} strokeWidth={1.4} /><div><strong>{message.data.variant.targetTitle || message.data.variant.title || t("chat.jobSpecificResume")}</strong><p>{currentResume ? t("chat.revisionReadyPreviewAndDownload") : t("chat.previousVersionViewTheLatestRevisionIn")}</p></div>
        {currentResume ? <button type="button" onClick={onOpenPreview}>{t("chat.openRevisedResume")}</button> : null}
        {currentResume ? <div className="aui-artifact-downloads"><a href={`/api/conversations/${encodeURIComponent(conversation.id)}/resume.pdf`}><Download size={13} />PDF</a><a href={`/api/conversations/${encodeURIComponent(conversation.id)}/resume.docx`}><Download size={13} />DOCX</a></div> : null}
      </div> : <MessageResult message={message} context={conversation?.context} onSelectJob={onSelectJob} />}
    </div>
    {assistant ? <ActionBarPrimitive.Root className="aui-message-actions" autohide="never">
      <ActionBarPrimitive.Copy data-copied={isCopied} aria-label={isCopied ? t("chat.replyCopied") : t("chat.copyReply")} title={t("chat.copyReply")}><span className="copy-icons"><Copy size={14} /><Check size={14} /></span></ActionBarPrimitive.Copy>
      {['diagnosis', 'resume', 'interview'].includes(message.kind) ? <button type="button" onClick={onOpenPreview}><FileText size={14} />{t("chat.viewMaterials")}</button> : null}
    </ActionBarPrimitive.Root> : null}
  </MessagePrimitive.Root>;
}
