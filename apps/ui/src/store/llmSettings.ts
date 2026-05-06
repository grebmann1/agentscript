/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * User-supplied LLM endpoint settings. Used by the Simulator page to drive
 * `@agentscript/runtime-vercel`'s `createAgent`. Stored in localStorage for
 * convenience — this is a demo UI, not a production app. Clear warning in
 * the settings dialog that the key sits in localStorage.
 */
export interface LlmSettings {
  /** Base URL for the OpenAI-compatible endpoint (e.g. https://api.openai.com/v1). */
  baseUrl: string;
  /** API key passed as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  /** Model identifier (e.g. "gpt-4o-mini"). */
  model: string;
  /** Wire protocol. Pinned to "openai" for v1; placeholder for future expansion. */
  provider: 'openai';
}

interface LlmSettingsState extends LlmSettings {
  setSettings: (patch: Partial<LlmSettings>) => void;
  clear: () => void;
  isConfigured: () => boolean;
}

const DEFAULT: LlmSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  provider: 'openai',
};

export const useLlmSettingsStore = create<LlmSettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT,
      setSettings: patch => set(patch),
      clear: () => set({ ...DEFAULT }),
      isConfigured: () => {
        const { baseUrl, apiKey, model } = get();
        return Boolean(baseUrl && apiKey && model);
      },
    }),
    {
      name: 'agentscript.llm-settings',
      storage: createJSONStorage(() => localStorage),
      partialize: state => ({
        baseUrl: state.baseUrl,
        apiKey: state.apiKey,
        model: state.model,
        provider: state.provider,
      }),
    }
  )
);
