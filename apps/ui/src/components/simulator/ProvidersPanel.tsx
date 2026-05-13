/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useRef, useState } from 'react';
import { Globe, Server, Trash2, Zap } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Switch } from '~/components/ui/switch';
import { cn } from '~/lib/utils';
import {
  useToolProviderStore,
  type ToolProvider,
} from '~/store/toolProviderStore';
import { McpBrowserAdapter } from '~/lib/mcp-browser-adapter';

export function ProvidersPanel() {
  const providers = useToolProviderStore(s => s.providers);
  const addProvider = useToolProviderStore(s => s.addProvider);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="space-y-0.5">
          <div className="text-sm font-medium">Tool providers</div>
          <div className="text-xs text-muted-foreground">
            Connect to external HTTP or MCP tool servers.
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => addProvider('http')}
          >
            <Globe className="h-3.5 w-3.5" />
            HTTP
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => addProvider('mcp')}
          >
            <Server className="h-3.5 w-3.5" />
            MCP
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {providers.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No providers configured. Add an HTTP or MCP server to connect your
            agent to real tools during simulation.
          </div>
        ) : (
          <ul className="space-y-3">
            {providers.map(provider => (
              <ProviderRow key={provider.id} provider={provider} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ProviderRow({ provider }: { provider: ToolProvider }) {
  const updateProvider = useToolProviderStore(s => s.updateProvider);
  const removeProvider = useToolProviderStore(s => s.removeProvider);
  const toggleProvider = useToolProviderStore(s => s.toggleProvider);
  const setDiscoveredTools = useToolProviderStore(s => s.setDiscoveredTools);

  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleTest = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setTesting(true);
    setTestError(null);
    try {
      if (provider.type === 'mcp') {
        const headers = parseHeadersSafe(provider.headers);
        const adapter = new McpBrowserAdapter(provider.url, headers);
        const tools = await adapter.listTools(controller.signal);
        setDiscoveredTools(
          provider.id,
          tools.map(t => t.name)
        );
      } else {
        const headers = parseHeadersSafe(provider.headers);
        const res = await fetch(provider.url, {
          method: 'OPTIONS',
          headers,
          signal: controller.signal,
        });
        if (!res.ok && res.status !== 204) {
          throw new Error(`HTTP ${res.status}`);
        }
        setDiscoveredTools(provider.id, ['(connected)']);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setTestError(err instanceof Error ? err.message : String(err));
      setDiscoveredTools(provider.id, []);
    } finally {
      if (!controller.signal.aborted) setTesting(false);
    }
  };

  return (
    <li
      className={cn(
        'rounded-md border p-3 space-y-2',
        !provider.enabled && 'opacity-60'
      )}
    >
      <div className="flex items-center gap-2">
        <Switch
          checked={provider.enabled}
          onCheckedChange={() => toggleProvider(provider.id)}
          aria-label="Enable provider"
        />
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
          {provider.type}
        </span>
        <Input
          value={provider.name}
          onChange={e => updateProvider(provider.id, { name: e.target.value })}
          placeholder="Provider name"
          className="h-7 text-xs"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => removeProvider(provider.id)}
          aria-label="Delete provider"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={provider.url}
          onChange={e => updateProvider(provider.id, { url: e.target.value })}
          placeholder={
            provider.type === 'mcp' ? '/mcp-proxy' : 'http://localhost:3000'
          }
          className="font-mono text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleTest()}
          disabled={testing || !provider.url.trim()}
        >
          <Zap className="h-3.5 w-3.5" />
          {testing ? '...' : 'Test'}
        </Button>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          Headers (optional)
        </summary>
        <Input
          value={provider.headers ?? ''}
          onChange={e =>
            updateProvider(provider.id, { headers: e.target.value })
          }
          placeholder='{"Authorization": "Bearer ..."}'
          className="mt-1 font-mono text-xs"
        />
      </details>

      {testError && (
        <p className="text-xs text-red-600 dark:text-red-400">{testError}</p>
      )}

      {provider.discoveredTools && provider.discoveredTools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {provider.discoveredTools.map(tool => (
            <span
              key={tool}
              className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
            >
              {tool}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

function parseHeadersSafe(raw?: string): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // ignore
  }
  return {};
}
