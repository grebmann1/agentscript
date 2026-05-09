/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Msg } from '../llm/types.js';

export interface DelegationOptions {
  /** Max LLM steps the delegated node may take before timeout. Default: 10 */
  maxSteps?: number;
  /** Max delegation depth (prevent infinite recursive delegation). Default: 5 */
  maxDepth?: number;
  /** Additional context/instructions passed to the child's system prompt */
  context?: string;
  /** Whether to share the parent's conversation history with the child. Default: false */
  shareHistory?: boolean;
}

export interface DelegationFrame {
  /** The parent node that initiated the delegation */
  parentNode: string;
  /** The child node being delegated to */
  childNode: string;
  /** Parent's message history at the point of delegation (frozen snapshot) */
  parentHistory: readonly Msg[];
  /** Current depth in the delegation stack */
  depth: number;
  /** Options passed to this delegation */
  options: Required<DelegationOptions>;
}

export interface DelegationResult {
  /** The text response produced by the child node */
  assistantText: string;
  /** State changes made by the child (key-value snapshot of mutations) */
  stateChanges: Record<string, unknown>;
  /** Which node the child ended on (could differ if child did handoffs internally) */
  finalNode: string;
  /** Number of LLM steps the child took */
  steps: number;
}
