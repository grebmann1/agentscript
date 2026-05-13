/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ProviderType = 'http' | 'mcp';

export interface ToolProvider {
  id: string;
  name: string;
  type: ProviderType;
  /** Base URL for HTTP providers; JSON-RPC endpoint URL for MCP providers. */
  url: string;
  /** JSON string of custom headers (optional). */
  headers?: string;
  enabled: boolean;
  /** Tool names discovered via test/connect. */
  discoveredTools?: string[];
}

interface ToolProviderState {
  providers: ToolProvider[];
  addProvider: (type: ProviderType) => void;
  updateProvider: (id: string, patch: Partial<ToolProvider>) => void;
  removeProvider: (id: string) => void;
  toggleProvider: (id: string) => void;
  setDiscoveredTools: (id: string, tools: string[]) => void;
}

export const useToolProviderStore = create<ToolProviderState>()(
  persist(
    (set) => ({
      providers: [],
      addProvider: (type) => {
        const id =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2);
        set((state) => ({
          providers: [
            ...state.providers,
            {
              id,
              name: type === 'mcp' ? 'MCP Server' : 'HTTP Tools',
              type,
              url: type === 'mcp' ? '/mcp-proxy' : 'http://localhost:3000',
              enabled: true,
            },
          ],
        }));
      },
      updateProvider: (id, patch) =>
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, ...patch } : p
          ),
        })),
      removeProvider: (id) =>
        set((state) => ({
          providers: state.providers.filter((p) => p.id !== id),
        })),
      toggleProvider: (id) =>
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, enabled: !p.enabled } : p
          ),
        })),
      setDiscoveredTools: (id, tools) =>
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, discoveredTools: tools } : p
          ),
        })),
    }),
    {
      name: 'agentscript.tool-providers',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        providers: state.providers.map(({ discoveredTools, ...rest }) => rest),
      }),
    }
  )
);
