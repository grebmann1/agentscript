/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Msg } from '../llm/types.js';

export const CHECKPOINT_SCHEMA_VERSION = 1;

export interface Checkpoint {
  schemaVersion: number;
  createdAt: string;
  id: string;
  currentNode: string;
  history: Msg[];
  stateValues: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface CheckpointStore {
  save(checkpoint: Checkpoint): Promise<string>;
  load(id: string): Promise<Checkpoint | null>;
  list(filter?: { limit?: number }): Promise<string[]>;
  delete(id: string): Promise<void>;
}
