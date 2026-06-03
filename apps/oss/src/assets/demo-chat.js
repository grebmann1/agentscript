import {
  startDemoSession,
  endDemoSession,
  streamDemoMessage,
} from './demo-agent-api.js';

const root = document.querySelector('[data-demo-chat]');
if (root) {
  initDemoChat(root);
}

function initDemoChat(el) {
  const log = el.querySelector('[data-demo-log]');
  const status = el.querySelector('[data-demo-status]');
  const errorEl = el.querySelector('[data-demo-error]');
  const form = el.querySelector('[data-demo-compose]');
  const input = el.querySelector('[data-demo-input]');
  const startBtn = el.querySelector('[data-demo-start]');
  const endBtn = el.querySelector('[data-demo-end]');
  const sendBtn = el.querySelector('[data-demo-send]');
  const viewScriptBtn = el.querySelector('[data-demo-view-script]');
  const scriptPanel = el.querySelector('[data-demo-script-panel]');
  const scriptCode = el.querySelector('[data-demo-script-code]');

  let sessionId = null;
  let busy = false;
  let scriptLoaded = false;

  startBtn.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true, 'Starting session…');
    clearError();
    try {
      if (sessionId) await safeEnd(sessionId);
      const { sessionId: id } = await startDemoSession();
      sessionId = id;
      clearLog();
      appendAssistant(
        'Hi! I can help you plan a trip — search flights and hotels, then book them. Try the prefilled prompt below or write your own.'
      );
      status.textContent = `Session ${shortId(id)}`;
      input.disabled = false;
      sendBtn.disabled = false;
      endBtn.disabled = false;
      input.focus();
    } catch (error) {
      status.textContent = 'Failed to start session';
      showError(messageOf(error));
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
      status.textContent = 'No active session';
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
    clearError();
    appendUser(text);
    const pending = appendAssistant('Thinking…', { pending: true });
    setBusy(true);
    try {
      await streamDemoMessage(sessionId, text, {
        onStatus: s => {
          pending.bubble.textContent = `${s}…`;
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
      showError(messageOf(error));
    } finally {
      setBusy(false);
      input.focus();
    }
  });

  if (viewScriptBtn && scriptPanel && scriptCode) {
    viewScriptBtn.addEventListener('click', async () => {
      const open = !scriptPanel.hasAttribute('hidden');
      if (open) {
        scriptPanel.setAttribute('hidden', '');
        viewScriptBtn.setAttribute('aria-expanded', 'false');
        viewScriptBtn.textContent = 'View script';
        return;
      }
      scriptPanel.removeAttribute('hidden');
      viewScriptBtn.setAttribute('aria-expanded', 'true');
      viewScriptBtn.textContent = 'Hide script';
      if (!scriptLoaded) {
        try {
          const res = await fetch('./assets/agents/mcp_demo.agent');
          if (!res.ok) throw new Error(`Failed to load script (${res.status})`);
          scriptCode.textContent = await res.text();
          scriptLoaded = true;
        } catch (error) {
          scriptCode.textContent = `// ${messageOf(error)}`;
        }
      }
    });
  }

  function setBusy(value, statusText) {
    busy = value;
    sendBtn.disabled = value || !sessionId;
    if (statusText) status.textContent = statusText;
  }

  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.removeAttribute('hidden');
  }
  function clearError() {
    if (!errorEl) return;
    errorEl.textContent = '';
    errorEl.setAttribute('hidden', '');
  }

  function clearLog() {
    while (log.firstChild) log.removeChild(log.firstChild);
  }

  function renderEmpty() {
    clearLog();
    const empty = document.createElement('p');
    empty.className = 'demo-empty';
    empty.textContent =
      'Start a session, then ask the agent to search flights, search hotels, and book a trip via MCP tools.';
    log.appendChild(empty);
  }

  function appendUser(text) {
    return appendMessage('user', 'USER', text);
  }
  function appendAssistant(text, opts = {}) {
    return appendMessage('assistant', 'ASSISTANT', text, opts);
  }

  function appendMessage(kind, role, text, opts = {}) {
    const empty = log.querySelector('.demo-empty');
    if (empty) empty.remove();
    const wrapper = document.createElement('div');
    wrapper.className = `demo-msg ${kind}${opts.pending ? ' pending' : ''}`;
    const roleEl = document.createElement('span');
    roleEl.className = 'demo-role';
    roleEl.textContent = role;
    const bubble = document.createElement('div');
    bubble.className = 'demo-bubble';
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

// Render a tiny subset of Markdown safely by building DOM nodes — never
// inserting any string as HTML. Supports bold (**x**), inline `code`, bullet
// lists, and paragraph breaks. Everything else is plain text.
function renderMarkdown(target, source) {
  while (target.firstChild) target.removeChild(target.firstChild);
  const lines = source.split('\n');
  let listEl = null;
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = document.createElement('div');
    appendInline(p, paragraph.join(' '));
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
      appendInline(li, line.replace(/^\s*[-*]\s+/, ''));
      listEl.appendChild(li);
      continue;
    }
    listEl = null;
    paragraph.push(line);
  }
  flushParagraph();

  if (!target.childNodes.length) {
    target.textContent = source;
  }
}

// Walk a string, emit text nodes for plain runs and <strong>/<code> elements
// for inline markers. No HTML parsing, no innerHTML — every literal
// character from the source ends up as a Text node.
function appendInline(target, text) {
  const tokenRe = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let lastIndex = 0;
  for (const m of text.matchAll(tokenRe)) {
    if (m.index > lastIndex) {
      target.appendChild(
        document.createTextNode(text.slice(lastIndex, m.index))
      );
    }
    if (m[1] !== undefined) {
      const strong = document.createElement('strong');
      strong.textContent = m[1];
      target.appendChild(strong);
    } else if (m[2] !== undefined) {
      const code = document.createElement('code');
      code.textContent = m[2];
      target.appendChild(code);
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    target.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}
