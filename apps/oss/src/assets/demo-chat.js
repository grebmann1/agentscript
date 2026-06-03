import {
  startDemoSession,
  endDemoSession,
  streamDemoMessage,
} from './demo-agent-api.js';

const root = document.querySelector('.demo-chat');
if (root) {
  initDemoChat(root);
}

function initDemoChat(el) {
  const log = el.querySelector('[data-role="log"]');
  const meta = el.querySelector('[data-role="meta"]');
  const form = el.querySelector('[data-role="form"]');
  const input = el.querySelector('[data-role="input"]');
  const startBtn = el.querySelector('[data-action="start"]');
  const endBtn = el.querySelector('[data-action="end"]');
  const sendBtn = el.querySelector('[data-action="send"]');
  const prefill = el.dataset.prefill ?? '';

  let sessionId = null;
  let busy = false;

  renderEmpty();

  startBtn.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true, 'Starting session…');
    try {
      if (sessionId) await safeEnd(sessionId);
      const { sessionId: id } = await startDemoSession();
      sessionId = id;
      log.innerHTML = '';
      appendAssistant(
        'Hi! I can help you plan a trip — search flights and hotels, then book them. Try the prefilled prompt below or write your own.'
      );
      meta.textContent = `Session ${shortId(id)}`;
      input.disabled = false;
      sendBtn.disabled = false;
      endBtn.disabled = false;
      input.value = prefill;
      input.focus();
    } catch (error) {
      meta.textContent = 'Failed to start session';
      appendError(messageOf(error));
    } finally {
      setBusy(false);
    }
  });

  endBtn.addEventListener('click', async () => {
    if (!sessionId || busy) return;
    setBusy(true, 'Ending session…');
    try {
      await safeEnd(sessionId);
      sessionId = null;
      meta.textContent = 'No active session';
      input.disabled = true;
      sendBtn.disabled = true;
      endBtn.disabled = true;
      input.value = '';
      renderEmpty();
    } finally {
      setBusy(false);
    }
  });

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!sessionId || busy) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendUser(text);
    const pending = appendAssistant('Thinking…', { pending: true });
    setBusy(true);
    try {
      await streamDemoMessage(sessionId, text, {
        onStatus: status => {
          pending.bubble.textContent = `${status}…`;
        },
        onDelta: (_delta, full) => {
          pending.el.classList.remove('pending');
          renderMarkdown(pending.bubble, full);
        },
        onDone: full => {
          pending.el.classList.remove('pending');
          renderMarkdown(pending.bubble, full || '(no response)');
        },
        onError: msg => {
          pending.el.classList.add('error');
          pending.el.classList.remove('pending');
          pending.bubble.textContent = msg;
        },
      });
    } catch (error) {
      pending.el.classList.add('error');
      pending.el.classList.remove('pending');
      pending.bubble.textContent = messageOf(error);
    } finally {
      setBusy(false);
      input.focus();
    }
  });

  function setBusy(value, statusText) {
    busy = value;
    sendBtn.disabled = value || !sessionId;
    if (statusText) meta.textContent = statusText;
  }

  function renderEmpty() {
    log.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'demo-chat-empty';
    empty.textContent =
      'Click "Start new session" to spin up a fresh conversation with the demo agent.';
    log.appendChild(empty);
  }

  function appendUser(text) {
    return appendMessage('user', 'USER', text);
  }
  function appendAssistant(text, opts = {}) {
    return appendMessage('assistant', 'ASSISTANT', text, opts);
  }
  function appendError(text) {
    const msg = appendMessage('assistant', 'ASSISTANT', text);
    msg.el.classList.add('error');
    return msg;
  }

  function appendMessage(kind, role, text, opts = {}) {
    if (log.querySelector('.demo-chat-empty')) log.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = `demo-chat-msg ${kind}${opts.pending ? ' pending' : ''}`;
    const roleEl = document.createElement('span');
    roleEl.className = 'demo-chat-role';
    roleEl.textContent = role;
    const bubble = document.createElement('div');
    bubble.className = 'demo-chat-bubble';
    bubble.textContent = text;
    wrapper.appendChild(roleEl);
    wrapper.appendChild(bubble);
    log.appendChild(wrapper);
    log.scrollTop = log.scrollHeight;
    return { el: wrapper, bubble };
  }

  async function safeEnd(id) {
    try {
      await endDemoSession(id);
    } catch {
      // Best-effort: server may have already evicted the session.
    }
  }
}

function shortId(id) {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function messageOf(error) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Something went wrong.';
}

// Render a tiny subset of Markdown safely: bold (**x**), inline `code`,
// bullet lists, and paragraph breaks. Anything else falls through as text.
function renderMarkdown(target, source) {
  target.innerHTML = '';
  const lines = source.split('\n');
  let listEl = null;
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = document.createElement('div');
    p.innerHTML = inline(paragraph.join(' '));
    target.appendChild(p);
    paragraph = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      listEl = null;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph();
      if (!listEl) {
        listEl = document.createElement('ul');
        target.appendChild(listEl);
      }
      const li = document.createElement('li');
      li.innerHTML = inline(line.replace(/^\s*[-*]\s+/, ''));
      listEl.appendChild(li);
      continue;
    }
    listEl = null;
    paragraph.push(line);
  }
  flushParagraph();

  // Empty result fallback.
  if (!target.childNodes.length) {
    target.textContent = source;
  }
}

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
