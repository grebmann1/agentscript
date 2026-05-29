/*
 * Tiny syntax highlighter — TypeScript / JavaScript / Bash.
 * Operates on <pre data-lang="..."><code>...</code></pre> blocks already in
 * the DOM. Keeps original text in the data-source attribute for copy actions.
 */

const TS_KEYWORDS = new Set([
  'import',
  'from',
  'export',
  'const',
  'let',
  'var',
  'function',
  'return',
  'async',
  'await',
  'class',
  'new',
  'if',
  'else',
  'for',
  'while',
  'of',
  'in',
  'as',
  'type',
  'interface',
  'extends',
  'implements',
  'this',
  'true',
  'false',
  'null',
  'undefined',
  'void',
  'try',
  'catch',
  'finally',
  'throw',
  'default',
  'switch',
  'case',
  'break',
  'continue',
  'public',
  'private',
  'protected',
  'readonly',
  'static',
]);

const AGENT_KEYWORDS = new Set([
  'agent',
  'tool',
  'on_message',
  'description',
  'let',
  'reply',
  'return',
  'string',
  'number',
  'boolean',
]);

const BASH_KEYWORDS = new Set([
  'curl',
  'pnpm',
  'npm',
  'node',
  'heroku',
  'git',
  'cd',
  'export',
  'sudo',
  'echo',
  'jq',
]);

const escape = s =>
  s.replace(
    /[&<>"]/g,
    c =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
      })[c]
  );

function highlightTs(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    // line comment
    if (ch === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out.push(`<span class="tok-c">${escape(src.slice(i, stop))}</span>`);
      i = stop;
      continue;
    }
    // block comment
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out.push(`<span class="tok-c">${escape(src.slice(i, stop))}</span>`);
      i = stop;
      continue;
    }
    // strings
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\') j += 2;
        else j += 1;
      }
      out.push(`<span class="tok-s">${escape(src.slice(i, j + 1))}</span>`);
      i = j + 1;
      continue;
    }
    // numbers
    if (/[0-9]/.test(ch) && (i === 0 || /[^A-Za-z_]/.test(src[i - 1]))) {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j])) j += 1;
      out.push(`<span class="tok-n">${escape(src.slice(i, j))}</span>`);
      i = j;
      continue;
    }
    // identifiers / keywords
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j += 1;
      const word = src.slice(i, j);
      if (TS_KEYWORDS.has(word)) {
        out.push(`<span class="tok-k">${escape(word)}</span>`);
      } else if (src[j] === '(') {
        out.push(`<span class="tok-f">${escape(word)}</span>`);
      } else {
        out.push(escape(word));
      }
      i = j;
      continue;
    }
    out.push(escape(ch));
    i += 1;
  }
  return out.join('');
}

function highlightAgent(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '#' || (ch === '/' && src[i + 1] === '/')) {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out.push(`<span class="tok-c">${escape(src.slice(i, stop))}</span>`);
      i = stop;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += 1;
      out.push(`<span class="tok-s">${escape(src.slice(i, j + 1))}</span>`);
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      const word = src.slice(i, j);
      if (AGENT_KEYWORDS.has(word)) {
        out.push(`<span class="tok-k">${escape(word)}</span>`);
      } else {
        out.push(escape(word));
      }
      i = j;
      continue;
    }
    out.push(escape(ch));
    i += 1;
  }
  return out.join('');
}

function highlightBash(src) {
  const lines = src.split('\n').map(line => {
    if (line.startsWith('#')) {
      return `<span class="tok-c">${escape(line)}</span>`;
    }
    let rest = line;
    let prefix = '';
    if (line.startsWith('$ ')) {
      prefix = '<span class="tok-p">$</span> ';
      rest = line.slice(2);
    }
    const tokens = rest.match(/("[^"]*"|'[^']*'|[^\s]+|\s+)/g) ?? [rest];
    const rendered = tokens
      .map(tok => {
        if (/^\s+$/.test(tok)) return tok;
        if (tok.startsWith('"') || tok.startsWith("'")) {
          return `<span class="tok-s">${escape(tok)}</span>`;
        }
        if (BASH_KEYWORDS.has(tok)) {
          return `<span class="tok-k">${escape(tok)}</span>`;
        }
        if (tok.startsWith('-')) {
          return `<span class="tok-n">${escape(tok)}</span>`;
        }
        return escape(tok);
      })
      .join('');
    return prefix + rendered;
  });
  return lines.join('\n');
}

export function highlight(lang, src) {
  switch (lang) {
    case 'ts':
    case 'tsx':
    case 'js':
      return highlightTs(src);
    case 'agent':
      return highlightAgent(src);
    case 'bash':
    case 'sh':
    case 'shell':
      return highlightBash(src);
    default:
      return escape(src);
  }
}

export function applyHighlighting(root = document) {
  for (const pre of root.querySelectorAll('pre[data-lang]')) {
    const code = pre.querySelector('code');
    if (!code) continue;
    const src = code.textContent ?? '';
    pre.dataset.source = src;
    code.innerHTML = highlight(pre.dataset.lang, src);
  }
}
