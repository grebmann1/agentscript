/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CompletionItem } from 'vscode-languageserver';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';

type SnippetContext = 'procedure' | 'reasoningActions';

interface ExpressionSnippetDefinition {
  label: string;
  trigger: string;
  detail: string;
  documentation: string;
  context: SnippetContext;
  snippet: string;
}

interface ExpressionSnippetRequest {
  source: string;
  line: number;
  character: number;
  supportsSnippets: boolean;
}

const EXPRESSION_SNIPPETS: readonly ExpressionSnippetDefinition[] = [
  {
    label: 'if',
    trigger: 'if',
    detail: 'Snippet: if / else',
    documentation: 'Insert an if / else block.',
    context: 'procedure',
    snippet: [
      'if ${1:@variables.condition == True}:',
      '    ${2:| instructions}',
      'else:',
      '    ${3:| instructions}',
      '$0',
    ].join('\n'),
  },
  {
    label: 'transition',
    trigger: 'transition',
    detail: 'Snippet: transition to topic',
    documentation: 'Insert a transition statement.',
    context: 'procedure',
    snippet: ['transition to @topic.${1:topic_name}', '$0'].join('\n'),
  },
  {
    label: 'set',
    trigger: 'set',
    detail: 'Snippet: set variable',
    documentation: 'Insert a variable assignment.',
    context: 'procedure',
    snippet: ['set @variables.${1:variable_name} = ${2:value}', '$0'].join(
      '\n'
    ),
  },
  {
    label: 'run',
    trigger: 'run',
    detail: 'Snippet: run action',
    documentation: 'Insert an action invocation with input and output clauses.',
    context: 'procedure',
    snippet: [
      'run @actions.${1:action_name}',
      '    with ${2:param}=${3:value}',
      '    set @variables.${4:variable} = @outputs.${5:field}',
      '$0',
    ].join('\n'),
  },
  {
    label: '@utils.escalate',
    trigger: 'escalate',
    detail: 'Snippet: utility escalation action',
    documentation: 'Declare an escalation utility action.',
    context: 'reasoningActions',
    snippet: [
      '${1:escalate_to_human}: @utils.escalate',
      '    description: "${2:Escalate to a human agent}"',
      '$0',
    ].join('\n'),
  },
  {
    label: '@utils.transition',
    trigger: 'transition',
    detail: 'Snippet: utility transition action',
    documentation: 'Declare a topic transition utility action.',
    context: 'reasoningActions',
    snippet: [
      '${1:go_to_topic}: @utils.transition to @topic.${2:topic_name}',
      '    description: "${3:Transfer to another topic}"',
      '    available when ${4:@variables.condition == True}',
      '$0',
    ].join('\n'),
  },
  {
    label: '@utils.setVariables',
    trigger: 'set',
    detail: 'Snippet: utility variable assignment action',
    documentation: 'Declare a variable assignment utility action.',
    context: 'reasoningActions',
    snippet: [
      '${1:update_variable}: @utils.setVariables',
      '    with ${2:variable_name}=${3:value}',
      '    description: "${4:Set a variable value}"',
      '$0',
    ].join('\n'),
  },
];

/**
 * Provide PRD-defined expression snippets for procedural blocks and reasoning
 * action declarations.
 */
export function provideExpressionSnippetCompletions({
  source,
  line,
  character,
  supportsSnippets,
}: ExpressionSnippetRequest): CompletionItem[] {
  const lines = source.split('\n');
  const lineContent = lines[line] ?? '';
  const textBeforeCursor = lineContent.substring(0, character);
  const partial = textBeforeCursor.trimStart();
  const indentLength = textBeforeCursor.length - partial.length;
  const inProcedureBlock = isInProcedureBlock(lines, line);
  const inReasoningActionsBlock = isInReasoningActionsBlock(lines, line);

  console.log('[ExpressionSnippets] context', {
    line,
    character,
    partial,
    inProcedureBlock,
    inReasoningActionsBlock,
  });

  if (partial.includes(':')) return [];

  const procedurePrefix = partial.match(/^\w*$/)?.[0];
  if (procedurePrefix && inProcedureBlock) {
    return EXPRESSION_SNIPPETS.filter(
      snippet =>
        snippet.context === 'procedure' &&
        snippet.trigger.startsWith(procedurePrefix)
    ).map((snippet, index) =>
      toCompletionItem(
        snippet,
        line,
        character,
        indentLength,
        supportsSnippets,
        index
      )
    );
  }

  const utilityPrefix = partial.match(/^@utils\.?([\w-]*)$/)?.[1];
  if (utilityPrefix !== undefined && inReasoningActionsBlock) {
    return EXPRESSION_SNIPPETS.filter(
      snippet =>
        snippet.context === 'reasoningActions' &&
        snippet.trigger.startsWith(utilityPrefix)
    ).map((snippet, index) =>
      toCompletionItem(
        snippet,
        line,
        character,
        indentLength,
        supportsSnippets,
        index
      )
    );
  }

  return [];
}

/**
 * Convert LSP snippet insert text into readable plain text for clients that do
 * not advertise snippet support.
 */
export function snippetToPlainText(snippet: string): string {
  return snippet
    .replace(/\$\{\d+\|((?:\\.|[^\\|])*)\|\}/g, (_match, choices: string) =>
      unescapeSnippetText(firstSnippetChoice(choices))
    )
    .replace(/\$\{\d+:((?:\\.|[^\\}])*)\}/g, (_match, text: string) =>
      unescapeSnippetText(text)
    )
    .replace(/\$\{\d+\}/g, '')
    .replace(/\$\d+/g, '')
    .replace(/\\([$}\\,|])/g, '$1');
}

function toCompletionItem(
  definition: ExpressionSnippetDefinition,
  line: number,
  character: number,
  indentLength: number,
  supportsSnippets: boolean,
  index: number
): CompletionItem {
  const snippetText = adjustSnippetIndentation(
    definition.snippet,
    indentLength
  );
  const newText = supportsSnippets
    ? snippetText
    : snippetToPlainText(snippetText);

  return {
    label: definition.label,
    kind: CompletionItemKind.Snippet,
    detail: definition.detail,
    documentation: definition.documentation,
    filterText: definition.label,
    insertText: newText,
    insertTextFormat: supportsSnippets
      ? InsertTextFormat.Snippet
      : InsertTextFormat.PlainText,
    textEdit: {
      range: {
        start: { line, character: indentLength },
        end: { line, character },
      },
      newText,
    },
    sortText: `0000${index}`,
  };
}

function adjustSnippetIndentation(snippet: string, baseIndent: number): string {
  const lines = snippet.split('\n');
  if (lines.length <= 1) return snippet;

  const indentStr = ' '.repeat(baseIndent);
  return lines.map((ln, i) => (i === 0 ? ln : indentStr + ln)).join('\n');
}

function isInProcedureBlock(
  lines: readonly string[],
  cursorLine: number
): boolean {
  const cursorIndent = getIndent(lines[cursorLine] ?? '');
  for (const { indent, trimmed } of walkParentsByIndent(lines, cursorLine)) {
    if (trimmed === 'instructions: ->') return true;
    if (indent === 0 || indent >= cursorIndent) return false;
  }
  return false;
}

function isInReasoningActionsBlock(
  lines: readonly string[],
  cursorLine: number
): boolean {
  const parents = [...walkParentsByIndent(lines, cursorLine)];
  const actionsIndex = parents.findIndex(
    parent => parent.trimmed === 'actions:'
  );
  if (actionsIndex === -1) return false;

  return parents
    .slice(actionsIndex + 1)
    .some(parent => parent.trimmed === 'reasoning:');
}

function firstSnippetChoice(choices: string): string {
  let escaped = false;
  for (let i = 0; i < choices.length; i++) {
    const ch = choices[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === ',') {
      return choices.slice(0, i);
    }
  }
  return choices;
}

function unescapeSnippetText(text: string): string {
  return text.replace(/\\([$}\\,|])/g, '$1');
}

function getIndent(line: string): number {
  return line.length - line.trimStart().length;
}

function* walkParentsByIndent(
  lines: readonly string[],
  cursorLine: number
): Generator<{ line: number; indent: number; trimmed: string }> {
  let targetIndent = getIndent(lines[cursorLine] ?? '');
  for (let l = cursorLine - 1; l >= 0; l--) {
    const ln = lines[l];
    if (!ln || !ln.trim()) continue;
    const indent = getIndent(ln);
    if (indent >= targetIndent) continue;
    yield { line: l, indent, trimmed: ln.trimStart() };
    targetIndent = indent;
    if (indent === 0) break;
  }
}
