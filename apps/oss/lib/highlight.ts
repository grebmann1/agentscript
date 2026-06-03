/*
 * Tiny syntax highlighter — TypeScript / JavaScript / Bash / Agent / YAML.
 * Returns token streams (no HTML strings) so React can render them as
 * <span> elements without resorting to innerHTML.
 */

export type TokenKind = 'k' | 's' | 'n' | 'c' | 'f' | 'p' | 't';
export type Token = { kind?: TokenKind; text: string };

const TS_KEYWORDS = new Set([
  'import', 'from', 'export', 'const', 'let', 'var', 'function', 'return',
  'async', 'await', 'class', 'new', 'if', 'else', 'for', 'while', 'of', 'in',
  'as', 'type', 'interface', 'extends', 'implements', 'this', 'true', 'false',
  'null', 'undefined', 'void', 'try', 'catch', 'finally', 'throw', 'default',
  'switch', 'case', 'break', 'continue', 'public', 'private', 'protected',
  'readonly', 'static',
]);

const AGENT_KEYWORDS = new Set([
  'agent', 'tool', 'on_message', 'description', 'let', 'reply', 'return',
  'string', 'number', 'boolean',
]);

const BASH_KEYWORDS = new Set([
  'curl', 'pnpm', 'npm', 'node', 'heroku', 'git', 'cd', 'export', 'sudo',
  'echo', 'jq',
]);

function tokenizeTs(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out.push({ kind: 'c', text: src.slice(i, stop) });
      i = stop;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out.push({ kind: 'c', text: src.slice(i, stop) });
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\') j += 2;
        else j += 1;
      }
      out.push({ kind: 's', text: src.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) && (i === 0 || /[^A-Za-z_]/.test(src[i - 1]))) {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j])) j += 1;
      out.push({ kind: 'n', text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j += 1;
      const word = src.slice(i, j);
      if (TS_KEYWORDS.has(word)) {
        out.push({ kind: 'k', text: word });
      } else if (src[j] === '(') {
        out.push({ kind: 'f', text: word });
      } else {
        out.push({ text: word });
      }
      i = j;
      continue;
    }
    out.push({ text: ch });
    i += 1;
  }
  return mergePlain(out);
}

function tokenizeAgent(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '#' || (ch === '/' && src[i + 1] === '/')) {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out.push({ kind: 'c', text: src.slice(i, stop) });
      i = stop;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += 1;
      out.push({ kind: 's', text: src.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      const word = src.slice(i, j);
      if (AGENT_KEYWORDS.has(word)) {
        out.push({ kind: 'k', text: word });
      } else {
        out.push({ text: word });
      }
      i = j;
      continue;
    }
    out.push({ text: ch });
    i += 1;
  }
  return mergePlain(out);
}

function tokenizeBash(src: string): Token[] {
  const out: Token[] = [];
  const lines = src.split('\n');
  lines.forEach((line, idx) => {
    if (line.startsWith('#')) {
      out.push({ kind: 'c', text: line });
    } else {
      let rest = line;
      if (line.startsWith('$ ')) {
        out.push({ kind: 'p', text: '$' });
        out.push({ text: ' ' });
        rest = line.slice(2);
      }
      const tokens = rest.match(/("[^"]*"|'[^']*'|[^\s]+|\s+)/g) ?? [rest];
      for (const tok of tokens) {
        if (/^\s+$/.test(tok)) {
          out.push({ text: tok });
        } else if (tok.startsWith('"') || tok.startsWith("'")) {
          out.push({ kind: 's', text: tok });
        } else if (BASH_KEYWORDS.has(tok)) {
          out.push({ kind: 'k', text: tok });
        } else if (tok.startsWith('-')) {
          out.push({ kind: 'n', text: tok });
        } else {
          out.push({ text: tok });
        }
      }
    }
    if (idx < lines.length - 1) out.push({ text: '\n' });
  });
  return mergePlain(out);
}

function mergePlain(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const tok of tokens) {
    const last = out[out.length - 1];
    if (last && !last.kind && !tok.kind) {
      last.text += tok.text;
    } else {
      out.push({ ...tok });
    }
  }
  return out;
}

export function tokenize(lang: string, src: string): Token[] {
  switch (lang) {
    case 'ts':
    case 'tsx':
    case 'js':
      return tokenizeTs(src);
    case 'agent':
      return tokenizeAgent(src);
    case 'bash':
    case 'sh':
    case 'shell':
      return tokenizeBash(src);
    default:
      return [{ text: src }];
  }
}
