import { createTranslator, uiMessage, resolveUiMessage } from './i18n.js';
import { I18nProvider, LanguageToggle, useI18n } from './i18nContext.js';
import './motion.css';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ChevronLeft,
  ChevronDown,
  PanelLeft,
  PanelRight,
  ChevronRight,
  Download,
  FileText,
  Folder,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  Paperclip,
  Plus,
  Send,
  Settings,
  Sun,
  Trash2,
  Upload,
  X
} from "lucide-react";
import {
  importLocalConversations,
  requestJson,
  streamConversationMessage,
  validateResumeFile
} from "./api.js";
import "./fonts.css";
import "./styles.css";
import { readableDocumentName } from './documentName.js';
import { ApplicationPanel } from './components/ApplicationPanel.jsx';
import { CardToggles, WorkspaceCards, useWorkspaceCards } from './components/WorkspaceCards.jsx';
import { SideChat } from './components/SideChat.jsx';
const DesktopAccount = window.resumeDesktop ? React.lazy(() => import('./desktop/DesktopAccount.jsx').then(module => ({ default: module.DesktopAccount }))) : null;
const DesktopChrome = window.resumeDesktop ? React.lazy(() => import('./desktop/DesktopAccount.jsx').then(module => ({ default: module.DesktopChrome }))) : null;
const DesktopEntry = window.resumeDesktop ? React.lazy(() => import('./desktop/DesktopEntry.jsx')) : null;
import { PasswordResetForm } from './components/PasswordResetForm.jsx';
import { MotionGroup, Presence, usePresence, waitForMotion } from './motionHooks.jsx';
import { startRun, appendRunStatus } from './motionState.js';
const WorkspaceChat = React.lazy(() => import('./components/WorkspaceChat.jsx').then(module => ({ default: module.WorkspaceChat })));

const LANDING_VIDEO_URL = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260715_112512_f3b7a972-83dd-4401-9c4b-f08d3733f5ca.mp4";
const THEME_STORAGE_KEY = "resume-protocol.theme";
const NEW_CANDIDATE = "__new_candidate__";
const AUTH_ENDPOINTS = {
  login: "/api/auth/login",
  register: "/api/auth/register"
};

function App() {
  const { t } = useI18n();
  const [view, setView] = useState(() => window.location.hash === "#workspace" ? "workspace" : "landing");
  const [booting, setBooting] = useState(true);
  const [desktopIntro, setDesktopIntro] = useState(Boolean(window.resumeDesktop));
  const [user, setUser] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [activeCandidateId, setActiveCandidateId] = useState("");
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [documents, setDocuments] = useState([]);
  const [candidateFacts, setCandidateFacts] = useState([]);
  const [activeDocumentId, setActiveDocumentId] = useState("");
  const [modelSettings, setModelSettings] = useState({ mode: "default", protocol: "openai", baseUrl: "", model: "", hasApiKey: false });
  const [authMode, setAuthMode] = useState("login");
  const [authVisible, setAuthVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [projectEditor, setProjectEditor] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  function openEvidencePanel() {
    cardsController.open('documents');
  }
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [shortcutHints, setShortcutHints] = useState(false);
  useEffect(() => {
    let timer;
    const hide = () => { clearTimeout(timer); timer = undefined; setShortcutHints(false); };
    const down = event => {
      if ((event.key === 'Control' || event.key === 'Meta') && !event.repeat && !event.isComposing && !timer) timer = setTimeout(() => setShortcutHints(true), 400);
    };
    const up = event => { if (event.key === 'Control' || event.key === 'Meta') hide(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', hide);
    return () => { hide(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', hide); };
  }, []);
  useEffect(() => {
    // The URL is the single source of truth for which surface is showing. Without
    // this listener, a browser back gesture or trackpad swipe changes the address
    // bar but leaves React on the workspace, so the user sees the landing URL with
    // the workspace still on screen and cannot get back.
    const onHashChange = () => {
      const next = window.resumeDesktop || window.location.hash === "#workspace" ? "workspace" : "landing";
      setView(current => (current === next ? current : next));
      if (next === "landing") {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (view !== 'workspace') return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        if (window.matchMedia('(max-width: 860px)').matches) setSidebarOpen(value=>!value);
        else setSidebarCollapsed(value=>!value);
      }
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);
  const [pending, setPending] = useState(null);
  const [noticeValue, setNotice] = useState("");
  const notice = resolveUiMessage(noticeValue, t);
  const [theme, setTheme] = useState(() => readStoredTheme());
  const desktopEntryVisible = DesktopEntry && (desktopIntro || booting || !user || view !== "workspace");
  const fileInputRef = useRef(null);
  const activeConversationRef = useRef('');
  const activeCandidateRef = useRef('');
  const actionLockRef = useRef(false);
  const streamControllerRef = useRef(null);
  const sessionRef = useRef(0);
  const conversationActionRef = useRef(0);
  const deferredPromptRef = useRef('');

  useEffect(() => {
    if (!user || view !== "workspace" || authVisible || pending || actionLockRef.current || !deferredPromptRef.current) return;
    // Replay from the authenticated render, after workspace data has loaded.
    // Clear first so another render (or StrictMode effect) cannot send it twice.
    const prompt = deferredPromptRef.current;
    deferredPromptRef.current = '';
    void submitPrompt(prompt);
  }, [user, view, authVisible, pending]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || projects[0] || null,
    [activeProjectId, projects]
  );
  const activeConversation = useMemo(
    () => conversations.find((item) => !item.parentId && item.id === activeConversationId && item.candidateId === activeCandidateId) || conversations.find((item) => !item.parentId && item.candidateId === activeCandidateId) || null,
    [activeConversationId, activeCandidateId, conversations]
  );
  const activeCandidate = candidates.find(candidate => candidate.id === activeCandidateId) || null;
  const activeDocument = useMemo(
    () => documents.find((document) => document.id === activeDocumentId) || documents[0] || null,
    [activeDocumentId, documents]
  );
  const candidateDocumentsRef = useRef('');
  const annotations = activeConversation?.context?.annotations || [];
  activeConversationRef.current = activeConversation?.id || '';
  activeCandidateRef.current = activeCandidateId;
  candidateDocumentsRef.current = activeCandidateId;
  const resumeVariant = activeConversation?.context?.variant || activeConversation?.context?.formalResume || null;
  const cardsController = useWorkspaceCards(user?.id, activeConversation);

  useEffect(() => {
    document.documentElement.dataset.theme = desktopEntryVisible ? 'dark' : theme;
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* Keep the in-app theme usable when storage is denied. */ }
  }, [theme, desktopEntryVisible]);

  useEffect(() => {
    let alive = true;
    async function boot() {
      try {
        const [me, settings] = await Promise.all([
          requestJson("/api/auth/me", undefined, t),
          requestJson("/api/model-settings", undefined, t).catch(() => ({ settings: modelSettings }))
        ]);
        if (!alive) return;
        setUser(me.user || null);
        setModelSettings(settings.settings || modelSettings);
        if (me.user) {
          await loadWorkspace(alive);
          if (window.resumeDesktop || window.location.hash === "#workspace") setView("workspace");
        } else if (window.location.hash === "#workspace") {
          setNotice(uiMessage("workspace.yourSessionHasExpiredSignInBefore"));
          setAuthMode("login");
          setAuthVisible(true);
        }
      } catch (error) {
        if (alive) setNotice(error.message);
      } finally {
        if (alive) setBooting(false);
      }
    }
    boot();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!activeCandidateId) {
      setDocuments([]);
      return;
    }
    setDocuments([]);
    refreshDocuments(activeCandidateId);
  }, [activeCandidateId]);

  useEffect(() => {
    if (!activeCandidateId) { setCandidateFacts([]); return; }
    let cancelled = false;
    setCandidateFacts([]);
    requestJson(`/api/candidates/${encodeURIComponent(activeCandidateId)}/knowledge`, undefined, t)
      .then(result => { if (!cancelled) setCandidateFacts(result.facts || []); })
      .catch(() => { if (!cancelled) setCandidateFacts([]); });
    return () => { cancelled = true; };
  }, [activeCandidateId]);

  async function refreshCandidateFacts(candidateId) {
    const result = await requestJson(`/api/candidates/${encodeURIComponent(candidateId)}/knowledge`, undefined, t);
    if (candidateId === activeCandidateRef.current) setCandidateFacts(result.facts || []);
  }

  async function loadWorkspace(alive = true) {
    const [projectResult, conversationResult, candidateResult] = await Promise.all([
      requestJson("/api/projects", undefined, t),
      requestJson("/api/conversations", undefined, t),
      requestJson("/api/candidates", undefined, t)
    ]);
    if (!alive) return;
    const nextProjects = projectResult.projects || [];
    const nextConversations = (conversationResult.conversations || []).filter(item => !item.parentId);
    const nextCandidates = candidateResult.candidates || [];
    setProjects(nextProjects);
    setConversations(nextConversations);
    setCandidates(nextCandidates);
    setActiveCandidateId(current => nextCandidates.some(candidate => candidate.id === current) ? current : nextConversations[0]?.candidateId || nextCandidates[0]?.id || "");
    setActiveProjectId((current) => nextProjects.some((project) => project.id === current) ? current : nextProjects[0]?.id || "");
    setActiveConversationId((current) => nextConversations.some((conversation) => conversation.id === current) ? current : nextConversations[0]?.id || "");
  }

  async function refreshDocuments(candidateId) {
    try {
      const result = await requestJson(`/api/candidates/${encodeURIComponent(candidateId)}/documents`, undefined, t);
      if (candidateDocumentsRef.current !== candidateId) return;
      const next = (result.documents || []).map(doc=>({...doc,name:readableDocumentName(doc.name)}));
      setDocuments(next);
      setActiveDocumentId((current) => next.some((document) => document.id === current) ? current : next[0]?.id || "");
    } catch {
      if (candidateDocumentsRef.current !== candidateId) return;
      setDocuments([]);
      setActiveDocumentId("");
    }
  }

  function enterWorkspace() {
    if (!user) {
      setAuthMode("login");
      setAuthVisible(true);
      setNotice(uiMessage("workspace.signInToEnterYourWorkspaceAnd"));
      return;
    }
    // Assigning the hash unconditionally pushes a new history entry every time, so
    // several back gestures are needed to leave. Only navigate when it changes.
    if (window.location.hash !== "#workspace") window.location.hash = "workspace";
    setView("workspace");
  }

  async function completeAuth(authenticatedUser) {
    await loadWorkspace();
    setUser(authenticatedUser);
    setAuthVisible(false);
    if (window.location.hash !== "#workspace") window.location.hash = "workspace";
    setView("workspace");
  }

  async function submitAuth(event) {
    event.preventDefault();
    setNotice("");
    const form = new FormData(event.currentTarget);
    const payload = {
      email: String(form.get("email") || "").trim(),
      password: String(form.get("password") || "")
    };
    if (authMode === "register") payload.name = String(form.get("name") || "").trim();
    if (authMode === "register" && payload.password.length < 10) {
      setNotice(uiMessage("workspace.passwordMustBeAtLeast10Characters"));
      return;
    }
    try {
      const result = await requestJson(AUTH_ENDPOINTS[authMode], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }, t);
      await completeAuth(result.user);
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function logout() {
    sessionRef.current += 1;
    streamControllerRef.current?.abort();
    actionLockRef.current = false;
    setPending(null);
    try {
      await requestJson("/api/auth/logout", { method: "POST" }, t);
      setUser(null);
      if (window.resumeDesktop) { setSettingsVisible(false); setSidebarOpen(false); setPanelOpen(false); }
      setCandidates([]);
      setActiveCandidateId("");
      setProjects([]);
      setConversations([]);
      setDocuments([]);
      setCandidateFacts([]);
      setActiveProjectId("");
      setActiveConversationId("");
      setActiveDocumentId("");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setView("landing");
      setNotice("");
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function saveProjectName(event) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") || "").trim();
    if (!name) {
      setNotice(uiMessage("workspace.enterAProjectName"));
      return;
    }
    try {
      if (projectEditor?.project?.id) {
        const result = await requestJson(`/api/projects/${encodeURIComponent(projectEditor.project.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name })
        }, t);
        setProjects((current) => current.map((item) => item.id === result.project.id ? result.project : item));
      } else {
        const result = await requestJson("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name })
        }, t);
        setProjects((current) => [result.project, ...current]);
        setActiveProjectId(result.project.id);
      }
      setProjectEditor(null);
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function deleteProject(projectId) {
    try {
      await requestJson(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" }, t);
      await waitForMotion();
      const remaining = projects.filter((project) => project.id !== projectId);
      setProjects(remaining);
      setActiveProjectId(remaining[0]?.id || "");
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function createConversation() {
    if (!user) {
      setAuthMode("login");
      setAuthVisible(true);
      return null;
    }
    try {
      const result = await requestJson("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: activeCandidateId || null, projectId: activeProject?.id || activeProjectId || null })
      }, t);
      // The server binds a first-time user to an auto-created candidate.
      if (result.conversation.candidateId !== activeCandidateId) {
        await refreshCandidates();
        setActiveCandidateId(result.conversation.candidateId);
      }
      setConversations((current) => [result.conversation, ...current]);
      setActiveConversationId(result.conversation.id);
      setSidebarOpen(false);
      return result.conversation;
    } catch (error) {
      setNotice(error.message);
      return null;
    }
  }

  async function refreshCandidates() {
    try { setCandidates((await requestJson("/api/candidates", undefined, t)).candidates || []); }
    catch { /* The candidate list is display-only; the binding lives on the conversation. */ }
  }

  async function createCandidate(name) {
    if (!name.trim()) { setNotice(uiMessage("workspace.enterACandidateName")); return false; }
    try {
      const { candidate } = await requestJson("/api/candidates", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() })
      }, t);
      setCandidates(current => [candidate, ...current]);
      setActiveCandidateId(candidate.id);
      setActiveConversationId("");
      setNotice(uiMessage("workspace.switchedToNewConversationsWillUseThis", { name: candidate.name }));
      return true;
    } catch (error) { setNotice(error.message); return false; }
  }

  function selectCandidate(candidateId) {
    if (candidateId === activeCandidateId) return;
    setActiveCandidateId(candidateId);
    setActiveConversationId(conversations.find(item => !item.parentId && item.candidateId === candidateId)?.id || "");
    const candidate = candidates.find(item => item.id === candidateId);
    setNotice(candidate ? uiMessage("workspace.switchedTo", { name: candidate.name }) : "");
    setSidebarOpen(false);
  }

  async function patchConversation(conversationId, patch) {
    try {
      const result = await requestJson(`/api/conversations/${encodeURIComponent(conversationId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      }, t);
      replaceConversation(result.conversation);
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function deleteConversation(conversationId) {
    try {
      await requestJson(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" }, t);
      await waitForMotion();
      const remaining = conversations.filter((item) => item.id !== conversationId);
      setConversations(remaining);
      if (activeConversationId === conversationId) setActiveConversationId(remaining.find(item => item.candidateId === activeCandidateId)?.id || "");
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function ensureConversation() {
    if (activeConversation) return activeConversation;
    return createConversation();
  }

  async function submitPrompt(nextPrompt = '') {
    const content = String(nextPrompt || "").trim();
    if (!content || pending || actionLockRef.current) return;
    if (!user) {
      deferredPromptRef.current = content;
      setNotice(uiMessage("workspace.yourSessionHasExpiredSignInBefore"));
      setAuthMode("login");
      setAuthVisible(true);
      return;
    }
    actionLockRef.current = true;
    conversationActionRef.current += 1;
    const session = sessionRef.current;
    const controller = new AbortController();
    streamControllerRef.current = controller;
    setNotice("");
    let conversation;
    let errorConversationReconciled = false;
    try {
      conversation = await ensureConversation();
      if (!conversation || session !== sessionRef.current) return;
      appendLocalMessage(conversation.id, {
        id: `local-${Date.now()}`,
        role: "user",
        content,
        kind: "text",
        createdAt: new Date().toISOString()
      });
      setPending(startRun(conversation.id, t("workspace.analyzingYourMaterials")));
      const done = await streamConversationMessage(conversation.id, content, {
        signal: controller.signal,
        onEvent: (event) => {
          if (session !== sessionRef.current) return;
          if (event.type === "status") setPending(current => current?.conversationId === conversation.id ? appendRunStatus(current, event) : current);
          if (event.type === "message") appendLocalMessage(conversation.id, scrubAssistantMessage(event.message));
          if (event.type === "done" && event.conversation) replaceConversation(scrubConversation(event.conversation));
          if (event.type === "error" && event.conversation) {
            errorConversationReconciled = true;
            replaceConversation(scrubConversation(event.conversation));
          }
        }
      }, t);
      if (done && session === sessionRef.current) replaceConversation(scrubConversation(done));
      if (conversation.candidateId) refreshDocuments(conversation.candidateId);
    } catch (error) {
      if (error.name === "AbortError") return;
      if (conversation && !errorConversationReconciled) {
        appendLocalMessage(conversation.id, {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: t("workspace.thisStepDidNotComplete") + error.message,
          kind: "error",
          tone: "warning",
          createdAt: new Date().toISOString()
        });
      } else {
        setNotice(error.message);
      }
    } finally {
      if (streamControllerRef.current === controller) streamControllerRef.current = null;
      actionLockRef.current = false;
      if (session === sessionRef.current) setPending(null);
    }
  }

  async function cancelPrompt() {
    const conversationId = pending?.conversationId;
    const session = sessionRef.current;
    const action = conversationActionRef.current;
    if (streamControllerRef.current) setPending(current => current ? { ...current, stopping: true, label: t("workspace.stopping") } : current);
    streamControllerRef.current?.abort();
    if (!conversationId) return;
    setNotice(uiMessage("workspace.generationStoppedCompletedContentHasBeenKept"));
    try {
      const result = await requestJson(`/api/conversations/${encodeURIComponent(conversationId)}`, undefined, t);
      // Cancellation releases the composer before this snapshot arrives. A new
      // upload or turn owns the newer transcript and must not be rolled back.
      if (result.conversation && session === sessionRef.current && action === conversationActionRef.current) replaceConversation(scrubConversation(result.conversation));
    } catch { /* The local transcript remains available if reconciliation fails. */ }
  }

  async function selectJob(job) {
    if (pending || actionLockRef.current) return;
    if (!activeConversation) return;
    try {
      const result = await requestJson(`/api/conversations/${encodeURIComponent(activeConversation.id)}/context`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedJob: job })
      }, t);
      replaceConversation(scrubConversation(result.conversation));
    } catch (error) {
      setNotice(error.message);
    }
  }

  function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    uploadResumeFile(file);
  }

  function handleDroppedFiles(files) {
    const file = files?.[0];
    if (file && files.length > 1) setNotice(uiMessage("workspace.uploadOneFileAtATimeThe"));
    uploadResumeFile(file);
  }

  async function uploadResumeFile(file) {
    if (!file) return;
    if (pending || actionLockRef.current) {
      setNotice(uiMessage("workspace.aTaskIsRunningWaitUntilIt"));
      return;
    }
    const validation = validateResumeFile(file, t);
    if (!validation.ok) {
      setNotice(validation.error);
      return;
    }
    if (!user) {
      setAuthMode("login");
      setAuthVisible(true);
      return;
    }
    actionLockRef.current = true;
    conversationActionRef.current += 1;
    const session = sessionRef.current;
    let conversation;
    try {
      conversation = await ensureConversation();
      if (!conversation || session !== sessionRef.current) return;
      const form = new FormData();
      form.append("file", file);
      setPending(startRun(conversation.id, t("workspace.reading") + file.name));
      const result = await requestJson(`/api/conversations/${encodeURIComponent(conversation.id)}/documents`, {
        method: "POST",
        body: form,
        timeoutMs: 250_000
      }, t);
      if (session === sessionRef.current) {
        replaceConversation(scrubConversation(result.conversation));
        await refreshDocuments(conversation.candidateId);
        await refreshCandidateFacts(conversation.candidateId);
        await refreshCandidates();
      }
    } catch (error) {
      setNotice(error.message);
    } finally {
      actionLockRef.current = false;
      if (session === sessionRef.current) setPending(null);
    }
  }

  async function importLegacy() {
    try {
      const result = await importLocalConversations(window.localStorage, requestJson, t);
      await loadWorkspace();
      const count = result.count ?? result.imported ?? 0;
      setNotice(count ? uiMessage("workspace.importedPreviousConversations", { count: count }) : uiMessage("workspace.noPreviousLocalConversationsWereFoundTo"));
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const mode = form.get("mode") === "custom" ? "custom" : "default";
    const payload = { mode };
    if (mode === "custom") {
      payload.protocol = form.get("protocol");
      payload.baseUrl = String(form.get("baseUrl") || "").trim();
      payload.model = String(form.get("model") || "").trim();
      const apiKey = String(form.get("apiKey") || "").trim();
      if (apiKey) payload.apiKey = apiKey;
    }
    try {
      const result = await requestJson("/api/model-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }, t);
      setModelSettings(result.settings);
      setSettingsVisible(false);
      setNotice(uiMessage("workspace.modelSettingsSaved"));
    } catch (error) {
      setNotice(error.message);
    }
  }

  function appendLocalMessage(conversationId, message) {
    setConversations((current) => current.map((conversation) => (
      conversation.id === conversationId
        ? { ...conversation, messages: upsertMessage(conversation.messages || [], message), updatedAt: message.createdAt || conversation.updatedAt }
        : conversation
    )));
  }

  function upsertMessage(messages, message) {
    const index = messages.findIndex((item) => item.id && item.id === message.id);
    if (index < 0) return [...messages, message];
    return messages.map((item, currentIndex) => currentIndex === index ? message : item);
  }

  function replaceConversation(conversation) {
    setConversations((current) => {
      const exists = current.some((item) => item.id === conversation.id);
      return exists
        ? current.map((item) => item.id === conversation.id ? conversation : item)
        : [conversation, ...current];
    });
  }

  function renderWorkspaceCard(id) {
    if (id === 'sidechat') return <SideChat
      key={`${user?.id}-${activeConversation?.id || 'new'}`}
      parent={activeConversation}
      userId={user?.id}
      ensureParent={ensureConversation}
      documents={documents}
      renderAttachment={(message, items) => <AttachmentStatus message={message} documents={items} />}
      scrubMessage={scrubAssistantMessage}
    />;
    if (id === 'apply') return activeConversation?.candidateId
      ? <ApplicationPanel key={activeConversation.id} conversation={activeConversation} disabled={Boolean(pending)} />
      : <p className="card-empty">{t("workspace.startAConversationBeforeConnectingAnApplication")}</p>;
    return <EvidencePanel
      conversation={activeConversation}
      documents={documents}
      activeDocument={activeDocument}
      annotations={annotations}
      candidateFacts={candidateFacts}
      variant={resumeVariant}
      onDocument={setActiveDocumentId}
      onPrompt={submitPrompt}
      busy={Boolean(pending)}
    />;
  }

  const authPanel = <AuthPanel
    mode={authMode}
    visible={authVisible}
    notice={notice}
    onMode={setAuthMode}
    onClose={() => {
      setAuthVisible(false);
      if (deferredPromptRef.current) setNotice(uiMessage("workspace.yourSessionHasExpiredSignInBefore"));
    }}
    onSubmit={submitAuth}
    onReset={completeAuth}
  />;

  if (desktopEntryVisible) {
    return <React.Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#121211' }} />}><DesktopEntry
      intro={desktopIntro}
      booting={booting}
      user={user}
      notice={notice}
      onIntroDone={() => setDesktopIntro(false)}
      onSubmit={async ({ mode, email, password, name }) => {
        setNotice("");
        const result = await requestJson(AUTH_ENDPOINTS[mode], {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, ...(mode === 'register' ? { name } : {}) })
        }, t);
        if (!result.user) throw new Error(t("workspace.signInDidNotReturnAValid"));
        return result.user;
      }}
      onSuccess={completeAuth}
    /></React.Suspense>;
  }

  if (view === "landing") {
    return (
      <>
        <LandingPage
          booting={booting}
          user={user}
          onLogin={() => { setAuthMode("login"); setAuthVisible(true); }}
          onRegister={() => { setAuthMode("register"); setAuthVisible(true); }}
          onStart={enterWorkspace}
        />
        {authPanel}
      </>
    );
  }

  return (
    <div className="workspace-shell aui-workspace cards-workspace" data-theme={theme} data-shortcut-hints={shortcutHints} data-sidebar-open={sidebarOpen} data-sidebar-collapsed={sidebarCollapsed}>
      {DesktopChrome && <React.Suspense fallback={null}><DesktopChrome /></React.Suspense>}
      <MobileBar
        theme={theme}
        onMenu={() => setSidebarOpen(true)}
        cardsController={cardsController}
        onTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
      />
      <ProjectSidebar
        user={user}
        candidates={candidates}
        activeCandidateId={activeCandidateId}
        onCreateCandidate={createCandidate}
        onSelectCandidate={selectCandidate}
        projects={projects}
        activeProjectId={activeProject?.id || ""}
        conversations={conversations}
        activeConversationId={activeConversation?.id || ""}
        collapsed={sidebarCollapsed}
        open={sidebarOpen}
        notice={notice}
        onCollapse={() => setSidebarCollapsed((value) => !value)}
        onProject={setActiveProjectId}
        onCreateProject={() => setProjectEditor({ project: null })}
        onRenameProject={(project) => setProjectEditor({ project })}
        onDeleteProject={deleteProject}
        onNewConversation={createConversation}
        onSelectConversation={(id) => { setActiveConversationId(id); setSidebarOpen(false); }}
        onMoveConversation={(conversationId, projectId) => patchConversation(conversationId, { projectId })}
        onDeleteConversation={deleteConversation}
        onImport={importLegacy}
        onSettings={() => setSettingsVisible(true)}
        onLogout={logout}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="workspace-chat" key={activeCandidateId}>
        <ChatHeader
          onSidebar={() => setSidebarCollapsed(value=>!value)}
          cardsController={cardsController}
          project={activeProject}
          candidate={activeCandidate}
          conversation={activeConversation}
          theme={theme}
          onTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
          onTitle={(title) => activeConversation && patchConversation(activeConversation.id, { title })}
        />
        <React.Suspense fallback={<div role="status">{t("workspace.openingWorkspace")}</div>}><WorkspaceChat
          key={activeConversation?.id || 'new'}
          catalogUserId={user?.id || null}
          conversation={activeConversation}
          documents={documents}
          pending={pending?.conversationId === activeConversation?.id ? pending : null}
          busy={Boolean(pending)}
          canCancel={Boolean(pending?.conversationId === activeConversation?.id && streamControllerRef.current)}
          onSend={submitPrompt}
          onCancel={cancelPrompt}
          onAttach={() => fileInputRef.current?.click()}
          onDropFiles={handleDroppedFiles}
          onSelectJob={selectJob}
          onOpenPreview={openEvidencePanel}
          renderAttachment={(message, items) => <AttachmentStatus message={message} documents={items} />}
          scrubMessage={scrubAssistantMessage}
          notice={notice}
          onDismissNotice={() => setNotice('')}
        /></React.Suspense>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept=".pdf,.docx,.txt,.md,.json"
          disabled={Boolean(pending)}
          onChange={handleFile}
          aria-label={t("workspace.uploadAResumeFile")}
        />
      </main>
      <WorkspaceCards controller={cardsController} sidebarCollapsed={sidebarCollapsed} renderCard={renderWorkspaceCard} />
      <SettingsPanel
        visible={settingsVisible}
        settings={modelSettings}
        onClose={() => setSettingsVisible(false)}
        onSubmit={saveSettings}
      />
      <ProjectEditor
        editor={projectEditor}
        onClose={() => setProjectEditor(null)}
        onSubmit={saveProjectName}
      />
      {authPanel}
    </div>
  );
}

function LandingPage({ booting, user, onLogin, onRegister, onStart }) {
  const { t } = useI18n();
  return (
    <div className="landing-page">
      <nav className="landing-nav">
        <div className="landing-logo">Loomi<sup>®</sup></div>
        <div className="landing-links">
          <a href="#home">{t("workspace.home")}</a>
          <button type="button" onClick={onStart}>{t("workspace.workspace")}</button>
          <a href="#how-it-works">{t("workspace.howItWorks")}</a>
        </div>
        <div className="landing-actions">
          <LanguageToggle />
          {user ? <button type="button" onClick={onStart}>{t("landing.enter")}</button> : <><button type="button" onClick={onLogin}>{t("login.signIn")}</button><button type="button" onClick={onRegister}>{t("login.signUp")}</button></>}
        </div>
      </nav>
      <section className="landing-hero" id="home">
        <video
          className="landing-video"
          src={LANDING_VIDEO_URL}
          autoPlay
          muted
          playsInline
          preload="auto"
          loop={false}
          onEnded={(event) => event.currentTarget.pause()}
          aria-hidden="true"
        />
        <div className="landing-copy">
          <h1>{t("landing.build")}<br />{t("landing.prove")}</h1>
          <p>{t("workspace.turnRealExperienceIntoReliableEvidenceThen")}</p>
          <button type="button" onClick={onStart}>{booting ? t("landing.loading") : t("landing.start")}</button>
        </div>
      </section>
      <section className="landing-info" id="how-it-works" aria-label={t("landing.howLabel")}>
        <div className="info-copy">
          <div>
            <span>{t("landing.how")}</span>
            <h2>{t("landing.evidence")}<br />{t("landing.forward")}</h2>
          </div>
          <p>{t("workspace.resumeProtocolBringsResumesJobsAndConversations")}</p>
        </div>
        <div className="info-divider" />
        <div className="info-pills">
          {[t("landing.diagnosis"), t("landing.alignment"), t("landing.interview")].map((label, index) => (
            <button key={label} type="button"><span>{String(index + 1).padStart(2, "0")}</span><b>/</b>{label}<ChevronRight size={16} /></button>
          ))}
        </div>
      </section>
    </div>
  );
}

function MobileBar({ theme, onMenu, cardsController, onTheme }) {
  const { t } = useI18n();
  return (
    <header className="mobile-bar">
      <button type="button" onClick={onMenu} aria-label={t("workspace.openProjectDirectory")}><Menu size={19} /></button>
      <strong>Loomi</strong>
      <button type="button" onClick={onTheme} className="theme-toggle header-icon" aria-label={t("workspace.toggleLightDarkTheme")}><ThemeIcon theme={theme} /></button>
      <LanguageToggle />
      <CardToggles controller={cardsController} />
    </header>
  );
}

function ProjectSidebar({
  user,
  candidates,
  activeCandidateId,
  onCreateCandidate,
  onSelectCandidate,
  projects,
  activeProjectId,
  conversations,
  activeConversationId,
  collapsed,
  open,
  notice,
  onCollapse,
  onProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onNewConversation,
  onSelectConversation,
  onMoveConversation,
  onDeleteConversation,
  onImport,
  onSettings,
  onLogout,
  onClose
}) {
  const { t } = useI18n();
  const [candidateEditorOpen, setCandidateEditorOpen] = useState(false);
  const candidateNameRef = useRef(null);
  useEffect(() => { if (candidateEditorOpen) candidateNameRef.current?.focus(); }, [candidateEditorOpen]);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 860px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 860px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [deleting, setDeleting] = useState(null);
  async function remove(id, action) {
    if (deleting) return;
    setDeleting(id);
    try {
      await action();
    } finally { setDeleting(null); }
  }
  const activeConversations = conversations.filter((conversation) => !conversation.parentId && conversation.candidateId === activeCandidateId && (!activeProjectId || conversation.projectId === activeProjectId));
  const candidateName = candidates.find(candidate => candidate.id === activeCandidateId)?.name || t("workspace.candidate");
  const initials = candidateName.trim().split(/\s+/).map(part => Array.from(part)[0]).slice(0, 2).join('').toUpperCase();
  return (
    <>
      <button className="mobile-drawer sidebar-drawer" type="button" tabIndex={open ? 0 : -1} aria-hidden={!open || undefined} aria-label={t("workspace.closeProjectDirectory")} onClick={onClose} />
      <aside className="project-sidebar" inert={(mobile ? !open : collapsed) || undefined}>
        <header>
          <div className="candidate-header-context">
            <span className="candidate-initials" aria-hidden="true">{initials}</span>
            <strong>{candidateName}</strong><ChevronDown size={12} aria-hidden="true" />
            <select aria-label={t("workspace.switchCandidate")} value={candidates.length ? activeCandidateId : ''} onChange={event => event.target.value === NEW_CANDIDATE ? setCandidateEditorOpen(true) : onSelectCandidate(event.target.value)}>
              {!candidates.length ? <option value="" disabled hidden>{candidateName}</option> : null}
              {candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
              <option value={NEW_CANDIDATE}>{t("workspace.newCandidateOption")}</option>
            </select>
          </div>
          <button className="primary-action sidebar-new-conversation" type="button" aria-label={t("workspace.newConversation")} title={t("workspace.newConversation")} onClick={onNewConversation}><Plus size={17} /></button>
          <button type="button" onClick={onClose} className="drawer-close" aria-label={t("workspace.closeProjectDirectory")}><X size={18} /><kbd className="shortcut-hint">Esc</kbd></button>
        </header>
        <section className="candidate-switcher" aria-label={t("workspace.createCandidate")}>
          <div className="candidate-create-reveal" data-open={candidateEditorOpen} inert={!candidateEditorOpen || undefined}><div><form className="candidate-create" onSubmit={async event => {
            event.preventDefault();
            const name = String(new FormData(event.currentTarget).get('name') || '').trim();
            if (await onCreateCandidate(name)) setCandidateEditorOpen(false);
          }}>
            <input ref={candidateNameRef} name="name" maxLength={120} aria-label={t("workspace.candidateName")} placeholder={t("workspace.candidateName")} required onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setCandidateEditorOpen(false); } }} />
            <button type="submit">{t("workspace.create")}</button>
          </form></div></div>
          {!candidates.length ? <p>{t("workspace.startAConversationOrUploadAResume")}</p> : null}
        </section>
        <section className="sidebar-section conversation-tree">
          <div className="section-title"><span>{t("workspace.recents")}</span></div>
          <MotionGroup className="conversation-list" selector=".conversation-row" activeKey={activeConversationId}>
          {activeConversations.map((conversation, index) => (
            <div key={conversation.id} data-closing={deleting === conversation.id} style={{ '--enter-delay': `calc(var(--stagger) * ${Math.min(index, 7)})` }} className={"conversation-row" + (conversation.id === activeConversationId ? " active" : "")}>
              <button type="button" onClick={() => onSelectConversation(conversation.id)}>
                <MessageSquareText size={15} />
                <span>{conversation.title || t("workspace.newConversation")}</span>
              </button>
              {projects.length > 0 && <select value={conversation.projectId || ""} onChange={(event) => onMoveConversation(conversation.id, event.target.value || null)} aria-label={t("workspace.moveConversationToProject")}>
                <option value="">{t("workspace.unfiled")}</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>}
              <button type="button" onClick={() => remove(conversation.id, () => onDeleteConversation(conversation.id))} aria-label={t("workspace.deleteConversation")}><Trash2 size={13} /></button>
            </div>
          ))}
          </MotionGroup>
        </section>
        <section className="sidebar-section">
          <div className="section-title"><span>{t("workspace.projects")}</span><button type="button" onClick={onCreateProject} aria-label={t("workspace.newProject")}><Plus size={14} /></button></div>
          <MotionGroup className="project-list" selector=".project-row" activeKey={activeProjectId}>
            {projects.map((project, index) => (
              <div key={project.id} data-closing={deleting === project.id} style={{ '--enter-delay': `calc(var(--stagger) * ${Math.min(index, 7)})` }} className={"project-row" + (project.id === activeProjectId ? " active" : "")}>
                <button type="button" onClick={() => onProject(project.id)}><span className="project-dot" aria-hidden="true" /><span>{project.name || t("workspace.untitledProject")}</span></button>
                <button type="button" onClick={() => onRenameProject(project)} aria-label={t("workspace.renameProject")}><Settings size={13} /></button>
                <button type="button" onClick={() => remove(project.id, () => onDeleteProject(project.id))} aria-label={t("workspace.deleteProject")}><Trash2 size={13} /></button>
              </div>
            ))}
          </MotionGroup>
        </section>
        {notice ? <p className="sidebar-notice">{notice}</p> : null}
        <footer>
          <button type="button" className="sidebar-import" aria-label={t("workspace.importPreviousRecords")} onClick={onImport}><Upload size={13} /><span>{t("workspace.importRecords")}</span></button>
          {DesktopAccount && <React.Suspense fallback={null}><DesktopAccount user={user} onLogout={onLogout} /></React.Suspense>}
          <div className="sidebar-account-row">
          <button type="button" onClick={onSettings}><Settings size={15} /><span>{t("settings.title")}</span></button>
          {!DesktopAccount && <button type="button" onClick={onLogout}><LogOut size={15} /><span>{user?.name || user?.email || t("workspace.account")}</span></button>}
          <button type="button" className="sidebar-chevron" onClick={onCollapse} aria-label={collapsed ? t("workspace.expandProjectDirectory") : t("workspace.collapseProjectDirectory")}><ChevronLeft size={16} /></button>
          </div>
        </footer>
      </aside>
    </>
  );
}

function ThemeIcon({ theme }) {
  return <span className="theme-icon" aria-hidden="true"><Sun size={18} data-visible={theme === 'dark'} /><Moon size={18} data-visible={theme !== 'dark'} /></span>;
}

function ChatHeader({ project, candidate, conversation, theme, onTheme, onTitle, onSidebar, cardsController }) {
  const { t } = useI18n();
  const [titleDraft, setTitleDraft] = useState(conversation?.title || t("workspace.newConversation"));
  useEffect(() => {
    setTitleDraft(conversation?.title || t("workspace.newConversation"));
  }, [conversation?.id, conversation?.title]);
  function commitTitle() {
    const title = titleDraft.trim();
    if (conversation && title && title !== conversation.title) onTitle(title);
  }
  return (
    <header className="chat-header">
      <button type="button" className="header-icon" onClick={onSidebar} aria-label={t("workspace.toggleProjectDirectory")} title={t("workspace.toggleProjectDirectoryCtrlB")}><PanelLeft size={19}/><kbd className="shortcut-hint">Ctrl B</kbd></button>
      <div>
        <span>{candidate?.name || t("workspace.noCandidateSelected")} · {project?.name || t("workspace.unfiledProject")}</span>
        <div className="conversation-title-field"><input
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          aria-label={t("workspace.conversationTitle")}
          disabled={!conversation}
        /></div>
      </div>
      <nav className="chat-tools">
        <button type="button" className="header-icon" onClick={onTheme} aria-label={theme === 'dark' ? t("theme.light") : t("theme.dark")} title={t("workspace.toggleLightDarkTheme")}><ThemeIcon theme={theme} /></button>
        <LanguageToggle />
        <CardToggles controller={cardsController} />
      </nav>
    </header>
  );
}

function AttachmentStatus({ message, documents = [] }) {
  const { t } = useI18n();
  const fileName = message.data?.filename || t("workspace.uploadedFile");
  const documentId = message.data?.documentId;
  const documentStatus = documents.find((document) => document.id === documentId)?.parseStatus;
  const parseStatus = message.data?.parseStatus || message.data?.status || documentStatus || null;
  const state = parseStatus?.status || "unknown";
  return (
    <section className={`attachment-status ${state}`} aria-label={t("workspace.uploadStatus")}>
      <div className="attachment-icon"><FileText size={16} /></div>
      <div>
        <strong>{fileName}</strong>
        <p>{attachmentStatusText(parseStatus, t)}</p>
      </div>
      <span className="attachment-chip">{attachmentStatusBadge(state, t)}</span>
      <a className="document-link" href={`/api/documents/${encodeURIComponent(documentId)}`}><Download size={14} />{t("workspace.originalFile")}</a>
    </section>
  );
}

function attachmentStatusText(status, t = createTranslator()) {
  if (status?.message) return status.message;
  if (status?.status === "parsed") return t("workspace.fileSavedResumeSourceTextIsAvailable");
  if (status?.status === "needs_review") return t("workspace.fileSavedButTheExtractedTextNeeds");
  if (status?.status === "unreadable") return t("workspace.fileSavedButNoUsableTextWas");
  return t("workspace.fileSavedWaitingForExtractionNoCompleteness");
}

function attachmentStatusBadge(status, t = createTranslator()) {
  if (status === "parsed") return t("workspace.read");
  if (status === "needs_review") return t("workspace.needsReview");
  if (status === "unreadable") return t("workspace.unreadable");
  return t("workspace.pending");
}

function EvidencePanel({ conversation, documents, activeDocument, annotations, candidateFacts, variant, onDocument, onPrompt, busy }) {
  const { t } = useI18n();
  // The annotated PDF only exists for PDF originals. A TXT or DOCX preview has to stay
  // on the text endpoint instead of asking for an annotated.pdf that cannot be served.
  const hasAnnotations = activeDocument?.mimeType === 'application/pdf' && annotations.length > 0 && activeDocument?.conversationId === conversation?.id;
  const previewUrl = activeDocument
    ? hasAnnotations
      ? `/api/documents/${encodeURIComponent(activeDocument.id)}/annotated.pdf?inline=1`
      : `/api/documents/${encodeURIComponent(activeDocument.id)}?inline=1`
    : "";
  const annotatedDownloadUrl = activeDocument ? `/api/documents/${encodeURIComponent(activeDocument.id)}/annotated.pdf` : "";
  return (
    <aside className="evidence-panel">
      <div className="evidence-content">
      <MotionGroup as="section" className="document-tabs" activeKey={activeDocument?.id}>
        {documents.map((document) => (
          <button key={document.id} type="button" className={document.id === activeDocument?.id ? "active" : ""} onClick={() => onDocument(document.id)}>
            <FileText size={15} />{document.name}
          </button>
        ))}
      </MotionGroup>
      <section className="candidate-facts">
        <h3>{t("workspace.savedBackgroundFacts")}</h3>
        {candidateFacts.length ? candidateFacts.map(fact => <article key={fact.id}>
          <small>{({ identity: t("workspace.name"), contact: t("workspace.contact"), education: t("workspace.education"), experience: t("workspace.experience"), project: t("workspace.project"), skill: t("workspace.skills"), achievement: t("workspace.awards"), metric: t("workspace.metrics") })[fact.type] || fact.type} · {documents.find(item => item.id === fact.sourceId)?.name || t("workspace.uploadedMaterials")} · {fact.status === "verified" ? t("workspace.verified") : t("workspace.needsReview")}</small>
          <p>{fact.value}</p>
          <details><summary>{t("workspace.viewSourceEvidence")}</summary><blockquote>{fact.sourceQuote}</blockquote></details>
        </article>) : <p>{t("workspace.thisCandidateHasNoTraceableBackgroundFacts")}</p>}
      </section>
      {annotatedDownloadUrl && hasAnnotations ? (
        <a className="annotated-download" href={annotatedDownloadUrl}><Download size={14} />{t("workspace.downloadAnnotatedPdf")}</a>
      ) : null}
      <section className="pdf-preview" key={activeDocument?.id || 'empty'}>
        {previewUrl ? <iframe title={hasAnnotations ? t("workspace.aiAnnotatedPdfPreview") : t("workspace.originalFilePreview")} src={previewUrl} /> : <div><FileText size={28} /><p>{t("workspace.uploadAResumeToSeeSourceText")}</p></div>}
      </section>
      <section className="annotation-list">
        <h3>{t("workspace.aiEvidenceAnnotations")}</h3>
        {annotations.length ? annotations.map((item, index) => <AnnotationCard key={item.id || item.quote} item={item} index={index} />) : <div className="panel-empty"><p>{t("workspace.noAnnotationsYetAnalyzeYourResumeTo")}</p><button type="button" onClick={() => onPrompt(t("workspace.analyzeThisResume"))}>{t("workspace.analyzeThisResume")}</button></div>}
      </section>
      <section className="variant-preview">
        <div className="panel-title"><h3>{t("workspace.revisedResume")}</h3>{variant?.name ? <ResumeDownloads conversation={conversation} /> : null}</div>
        {variant?.name ? <ResumePreview variant={variant} /> : <div className="panel-empty"><p>{t("workspace.generateARevisedResumeToDownloadPdf")}</p><button type="button" onClick={() => onPrompt(t("workspace.generateARevisedResume"))}>{t("workspace.generateARevisedResume")}</button></div>}
        {conversation?.context?.variantId && <ResumeClaimEvidence key={conversation.context.variantId} conversation={conversation} />}
      </section>
      </div>
    </aside>
  );
}

function AnnotationCard({ item, index }) {
  const { t } = useI18n();
  return (
    <article tabIndex={0} style={{ '--enter-delay': `calc(var(--stagger) * ${Math.min(index, 7)})` }} className={"annotation-card " + (item.severity || "medium")}>
      <span className="annotation-source">{item.source === "rule" ? t("workspace.basicChecks") : t("workspace.aiAnnotation")}</span>
      <blockquote>{item.quote}</blockquote>
      <strong>{item.issue}</strong>
      <p>{item.suggestion}</p>
      <small>{[item.section, item.reason].filter(Boolean).join(" · ")}</small>
    </article>
  );
}

function ResumeDownloads({ conversation }) {
  const { t } = useI18n();
  const saved = conversation?.context?.export?.variantId === conversation?.context?.variantId ? conversation?.context?.export?.layout : null;
  const [template, setTemplate] = useState(saved?.template || 'auto');
  const [preview, setPreview] = useState(false);
  useEffect(() => { setTemplate(saved?.template || 'auto'); setPreview(false); }, [conversation?.id, conversation?.context?.variantId, saved?.template]);
  if (!conversation?.context?.variantId) return null;
  const query = new URLSearchParams({ variantId: conversation.context.variantId, template });
  if (saved?.sectionOrder && template === saved.template) query.set('sectionOrder', saved.sectionOrder.join(','));
  const base = `/api/conversations/${encodeURIComponent(conversation.id)}`;
  const pdf = `${base}/resume.pdf?${query}`;
  return (
    <div className="resume-layout-controls">
      <label>{t("workspace.applicationLayout")}<select aria-label={t("workspace.resumeLayout")} value={template} onChange={event => setTemplate(event.target.value)}>
        <option value="auto">{t("workspace.chooseBasedOnContent")}</option><option value="campus-project">{t("workspace.campusInternshipProjectsFirst")}</option><option value="experienced">{t("workspace.experiencedWorkFirst")}</option><option value="minimal">{t("workspace.minimalShorterContent")}</option>
      </select></label>
      <div className="resume-downloads">
        <a href={pdf}><Download size={14} />PDF</a>
        <a href={`${base}/resume.docx?${query}`}><Download size={14} />DOCX</a>
      </div>
      <details onToggle={event => setPreview(event.currentTarget.open)}><summary>{t("workspace.viewActualPdfPages")}</summary>
        <p>{t("workspace.fontSizesStayReadableAndPageCount")}</p>
        <a href={`${pdf}&inline=1`} target="_blank" rel="noreferrer">{t("workspace.openPdfPreview")}</a>
        {preview && <iframe className="generated-resume-pdf" title={t("workspace.jobSpecificResumePdfPagePreview")} src={`${pdf}&inline=1`} />}
      </details>
    </div>
  );
}

function ResumeClaimEvidence({ conversation }) {
  const { t } = useI18n();
  const [evidence, setEvidence] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    requestJson(`/api/conversations/${encodeURIComponent(conversation.id)}/resume-evidence`, { signal: controller.signal }, t)
      .then(setEvidence).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [conversation.id, conversation.context.variantId]);
  return <details className="candidate-facts"><summary>{t("workspace.viewSourcesForEveryFactInThis")}</summary>{error ? <p role="alert">{error}</p> : !evidence ? <p role="status">{t("workspace.checkingSources")}</p> : evidence.claims.map(claim => <article key={claim.field}><p>{claim.claimText}</p>{claim.factIds.map(id => {
    const fact = evidence.facts.find(item => item.id === id);
    return fact && <blockquote key={id}>{fact.sourceQuote}<small>{fact.sourceType === 'user_asserted' ? t("workspace.userProvided") : <a href={`/api/documents/${encodeURIComponent(fact.sourceId)}?inline=1`} target="_blank" rel="noreferrer">{t("workspace.viewOriginalFile")}</a>}</small></blockquote>;
  })}</article>)}</details>;
}

function ResumePreview({ variant }) {
  const { t } = useI18n();
  const sections = [
    [t("resume.education"), variant.education],
    [t("workspace.skills"), variant.skills],
    [t("resume.projects"), variant.projects],
    [t("workspace.workInternships"), variant.experience],
    [t("workspace.awards"), variant.awards]
  ];
  return (
    <article className="resume-preview">
      <h2>{variant.name || t("workspace.resume")}</h2>
      <p>{[variant.targetTitle || variant.title, ...Object.values(variant.contact || {}).filter(Boolean)].filter(Boolean).join(" · ")}</p>
      <p>{variant.summary}</p>
      {sections.filter(([, items]) => items?.length).map(([title, items]) => (
        <section key={title}>
          <h4>{title}</h4>
          {items.map((item) => <p key={item}>{item}</p>)}
        </section>
      ))}
    </article>
  );
}

function SettingsPanel({ visible, settings, onClose, onSubmit }) {
  const { t } = useI18n();
  const [mode, setMode] = useState(settings.mode || "default");
  const { mounted, closing } = usePresence(visible);
  useEffect(() => {
    if (visible) setMode(settings.mode || "default");
  }, [visible, settings.mode]);
  if (!mounted) return null;
  return (
    <div className="settings-layer" data-closing={closing} inert={closing || undefined} aria-hidden={closing || undefined} role="dialog" aria-modal="true" aria-label={t("settings.title")}>
      <form className="settings-panel" onSubmit={onSubmit}>
        <button type="button" className="drawer-close" onClick={onClose} aria-label={t("workspace.closeSettings")}><X size={18} /></button>
        <h2>{t("workspace.modelSettings")}</h2>
        <label>{t("workspace.mode")}<select name="mode" value={mode} onChange={(event) => setMode(event.target.value)}><option value="default">{t("workspace.default")}</option><option value="custom">{t("workspace.custom")}</option></select></label>
        {mode === "default" ? <p className="settings-note">{t("workspace.useTheSystemModelNoSetupRequired")}</p> : (
          <div className="custom-settings">
            <label>{t("workspace.protocol")}<select name="protocol" defaultValue={settings.protocol}><option value="openai">{t("settings.openai")}</option><option value="anthropic">Anthropic</option></select></label>
            <label>{t("settings.baseUrl")}<input name="baseUrl" defaultValue={settings.baseUrl || ""} placeholder="https://api.example.com/v1" /></label>
            <label>{t("settings.model")}<input name="model" defaultValue={settings.model || ""} placeholder={t("settings.modelName")} /></label>
            <label>{t("settings.apiKey")}<input name="apiKey" type="password" placeholder={settings.hasApiKey ? t("workspace.leaveBlankToKeepExistingKey") : t("workspace.pasteKey")} /></label>
          </div>
        )}
        <button type="submit">{t("workspace.saveSettings")}</button>
      </form>
    </div>
  );
}

function ProjectEditor({ editor, onClose, onSubmit }) {
  const { t } = useI18n();
  const { mounted, closing } = usePresence(Boolean(editor));
  const last = useRef(editor);
  if (editor) last.current = editor;
  if (!mounted) return null;
  const project = last.current?.project;
  return (
    <div className="settings-layer" data-closing={closing} inert={closing || undefined} aria-hidden={closing || undefined} role="dialog" aria-modal="true" aria-label={t("workspace.projectName")}>
      <form className="settings-panel project-editor" onSubmit={onSubmit}>
        <button type="button" className="drawer-close" onClick={onClose} aria-label={t("workspace.closeProjectNaming")}><X size={18} /></button>
        <h2>{project ? t("workspace.renameProject") : t("workspace.newProject")}</h2>
        <label>{t("workspace.projectNameField")}<input name="name" defaultValue={project?.name || ""} placeholder={t("workspace.eGFallRecruitingAiAgentRoles")} autoFocus required /></label>
        <button type="submit">{project ? t("workspace.saveName") : t("workspace.createProject")}</button>
      </form>
    </div>
  );
}

function AuthPanel({ mode, visible, notice, onMode, onClose, onSubmit, onReset }) {
  const { t } = useI18n();
  const { mounted, closing } = usePresence(visible);
  if (!mounted) return null;
  return (
    <div className="auth-layer" data-closing={closing} inert={closing || undefined} aria-hidden={closing || undefined} role="dialog" aria-modal="true" aria-label={{ login: t("login.signIn"), register: t("login.signUp"), reset: t("workspace.resetPassword") }[mode]}>
      {mode === "reset" ? <PasswordResetForm onBack={() => onMode("login")} onClose={onClose} onReset={onReset} /> : <form className="auth-panel" onSubmit={onSubmit}>
        <button type="button" className="drawer-close" onClick={onClose} aria-label={t("workspace.close")}><X size={18} /></button>
        <h2>{mode === "login" ? t("login.signIn") : t("login.signUp")}</h2>
        {mode === "register" ? <label>{t("workspace.name")}<input name="name" autoComplete="name" required /></label> : null}
        <label>{t("login.email")}<input name="email" type="email" autoComplete="email" required /></label>
        <label>{t("login.password")}<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 10 : undefined} required /></label>
        {notice ? <p role="alert">{notice}</p> : null}
        <button type="submit">{mode === "login" ? t("login.signIn") : t("login.signUp")}</button>
        <button type="button" className="text-button" onClick={() => onMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? t("workspace.createAnAccount") : t("workspace.alreadyHaveAnAccountSignIn")}
        </button>
        {mode === "login" ? <button type="button" className="text-button" onClick={() => onMode("reset")}>{t("workspace.forgotPassword")}</button> : null}
      </form>}
    </div>
  );
}

function scrubConversation(conversation) {
  return {
    ...conversation,
    title: readableDocumentName(conversation.title),
    messages: (conversation.messages || []).map(scrubAssistantMessage)
  };
}

function scrubAssistantMessage(message) {
  if (message.kind === 'attachment' && message.data?.filename) {
    const filename = readableDocumentName(message.data.filename);
    return {...message,data:{...message.data,filename},content:String(message.content || '').replace(message.data.filename,filename)};
  }
  return message;
}


function readStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "light" ? value : window.resumeDesktop ? "dark" : "light";
  } catch {
    return window.resumeDesktop ? "dark" : "light";
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nProvider><App /></I18nProvider>
  </React.StrictMode>
);
