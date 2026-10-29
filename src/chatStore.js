export const CHAT_STORAGE_KEY = "resume-protocol.chat.v1";

const WELCOME_MESSAGE = {
  role: "assistant",
  content: "告诉我你想推进什么。你可以粘贴简历、查找岗位、生成岗位版，或开始面试准备。",
  kind: "text"
};

const DEFAULT_CONTEXT = {
  material: "",
  profile: null,
  diagnosis: null,
  jobs: [],
  selectedJob: null,
  variant: null,
  formalResume: null
};

export function createConversation(options = {}) {
  const now = options.now || new Date().toISOString();
  const id = options.id || createId("chat");
  return {
    id,
    title: "新对话",
    createdAt: now,
    updatedAt: now,
    messages: [{ ...WELCOME_MESSAGE, id: `${id}-welcome`, createdAt: now }],
    context: createDefaultContext()
  };
}

export function createChatState(options = {}) {
  const conversation = createConversation(options);
  return {
    version: 1,
    activeConversationId: conversation.id,
    conversations: [conversation]
  };
}

export function appendMessage(state, conversationId, message) {
  return updateConversation(state, conversationId, (conversation) => {
    const messages = [...conversation.messages, message];
    const firstUserMessage = messages.find((item) => item.role === "user");
    return {
      ...conversation,
      title: conversation.title === "新对话" && firstUserMessage
        ? createConversationTitle(firstUserMessage.content)
        : conversation.title,
      updatedAt: message.createdAt || new Date().toISOString(),
      messages
    };
  });
}

export function updateConversationContext(state, conversationId, contextPatch) {
  return updateConversation(state, conversationId, (conversation) => ({
    ...conversation,
    updatedAt: new Date().toISOString(),
    context: { ...conversation.context, ...contextPatch }
  }));
}

export function deleteConversation(state, conversationId, fallbackOptions = {}) {
  const conversations = state.conversations.filter((item) => item.id !== conversationId);
  if (!conversations.length) return createChatState(fallbackOptions);
  return {
    ...state,
    conversations,
    activeConversationId: state.activeConversationId === conversationId
      ? conversations[0].id
      : state.activeConversationId
  };
}

export function loadChatState(storage, fallbackOptions = {}) {
  try {
    const value = storage?.getItem(CHAT_STORAGE_KEY);
    if (!value) return createChatState(fallbackOptions);
    const parsed = JSON.parse(value);
    if (parsed?.version !== 1 || !Array.isArray(parsed.conversations) || !parsed.conversations.length) {
      return createChatState(fallbackOptions);
    }
    const conversations = parsed.conversations
      .map((conversation) => normalizeConversation(conversation, fallbackOptions))
      .filter(Boolean);
    if (!conversations.length) return createChatState(fallbackOptions);
    const activeConversationId = conversations.some((item) => item.id === parsed.activeConversationId)
      ? parsed.activeConversationId
      : conversations[0].id;
    return { version: 1, activeConversationId, conversations };
  } catch {
    return createChatState(fallbackOptions);
  }
}

export function saveChatState(storage, state) {
  try {
    if (typeof storage?.setItem !== "function") return false;
    storage.setItem(CHAT_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function createConversationTitle(content) {
  const firstThought = String(content || "")
    .replace(/\s+/g, " ")
    .split(/[，。！？!?\n]/)[0]
    .trim();
  return firstThought.slice(0, 18) || "新对话";
}

function updateConversation(state, conversationId, updater) {
  return {
    ...state,
    conversations: state.conversations.map((conversation) => (
      conversation.id === conversationId ? updater(conversation) : conversation
    ))
  };
}

function normalizeConversation(value, fallbackOptions = {}) {
  if (!value?.id) return null;
  const now = fallbackOptions.now || new Date().toISOString();
  const messages = Array.isArray(value.messages)
    ? value.messages.map((message) => normalizeMessage(message, now)).filter(Boolean)
    : [];

  return {
    ...value,
    id: String(value.id),
    title: typeof value.title === "string" ? value.title : "新对话",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
    messages,
    context: { ...createDefaultContext(), ...(isPlainObject(value.context) ? value.context : {}) }
  };
}

function normalizeMessage(value, now) {
  if (!isPlainObject(value) || typeof value.role !== "string" || typeof value.content !== "string") {
    return null;
  }
  return {
    ...value,
    id: value.id ? String(value.id) : createId("message"),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now
  };
}

function createDefaultContext() {
  return { ...DEFAULT_CONTEXT, jobs: [] };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
