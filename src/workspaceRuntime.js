// The server owns history. assistant-ui receives a view of it, including our
// career result metadata; it never creates a second conversation repository.
export function visibleMessages(conversation) {
  return (conversation?.messages || []).filter(message =>
    ['user', 'assistant'].includes(message.role) && message.id !== `${conversation.id}-welcome`);
}

export function toAssistantMessage(message) {
  const createdAt = new Date(message.createdAt);
  return {
    id: message.id,
    role: message.role,
    content: [{ type: 'text', text: String(message.content || '') }],
    ...(Number.isNaN(createdAt.getTime()) ? {} : { createdAt }),
    metadata: { custom: { careerMessage: message } },
    ...(message.role === 'assistant' ? { status: { type: 'complete', reason: 'stop' } } : {}),
  };
}

export function promptText(message) {
  return (message.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
}
