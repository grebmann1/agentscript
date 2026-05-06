/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { cn } from '~/lib/utils';
import { useLlmSettingsStore } from '~/store/llmSettings';
declare const __AGENTSCRIPT_PACKAGE_VERSIONS__: Record<string, string>;
const packageVersions = __AGENTSCRIPT_PACKAGE_VERSIONS__;

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsSection = 'version' | 'general' | 'llm';

const sections: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'llm', label: 'LLM Endpoint' },
  { id: 'version', label: 'Version' },
];

/** Standalone Settings dialog (renders its own Dialog root). */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SettingsDialogContent />
    </Dialog>
  );
}

/** Settings dialog content — use inside an existing Dialog root. */
export function SettingsDialogContent() {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>('general');

  return (
    <DialogContent className="w-[70vw] max-w-300 sm:max-w-300 p-0 gap-0">
      <DialogHeader className="px-6 pt-6 pb-4 border-b">
        <DialogTitle>Settings</DialogTitle>
      </DialogHeader>

      <div className="flex h-125">
        {/* Left Navigation Panel */}
        <div className="w-48 border-r bg-muted/30 p-4">
          <nav className="space-y-1">
            {sections.map(section => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm rounded-md transition-colors',
                  activeSection === section.id
                    ? 'bg-background text-foreground font-medium shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                )}
              >
                {section.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Right Content Panel */}
        <div className="flex-1 p-6 overflow-y-auto">
          {activeSection === 'general' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-1">General Settings</h3>
                <p className="text-sm text-muted-foreground">
                  Configure general application preferences
                </p>
              </div>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  General settings will be added here as needed.
                </p>
              </div>
            </div>
          )}

          {activeSection === 'llm' && <LlmSettingsSection />}

          {activeSection === 'version' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-1">
                  Version Information
                </h3>
                <p className="text-sm text-muted-foreground">
                  Current versions of core dependencies
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">
                      AgentScript Parser
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Parser and grammar
                    </div>
                  </div>
                  <Badge variant="secondary" className="font-mono">
                    v{packageVersions['@agentscript/parser'] ?? 'unknown'}
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </DialogContent>
  );
}

/** Settings section for the Simulator's BYO OpenAI-compatible LLM endpoint. */
function LlmSettingsSection() {
  const { baseUrl, apiKey, model, setSettings, clear } = useLlmSettingsStore();
  const [local, setLocal] = useState({ baseUrl, apiKey, model });
  const dirty =
    local.baseUrl !== baseUrl ||
    local.apiKey !== apiKey ||
    local.model !== model;

  const handleSave = () => {
    setSettings({
      baseUrl: local.baseUrl.trim(),
      apiKey: local.apiKey.trim(),
      model: local.model.trim(),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1">LLM Endpoint</h3>
        <p className="text-sm text-muted-foreground">
          Configure the OpenAI-compatible endpoint used by the Simulator.
        </p>
      </div>

      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
        <strong>Warning:</strong> The API key is stored in your browser&apos;s
        localStorage and sent directly from the browser to the endpoint. This is
        fine for local experimentation but not safe for production or shared
        machines.
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="llm-base-url">Base URL</Label>
          <Input
            id="llm-base-url"
            placeholder="https://api.openai.com/v1"
            value={local.baseUrl}
            onChange={e =>
              setLocal(prev => ({ ...prev, baseUrl: e.target.value }))
            }
          />
          <p className="text-xs text-muted-foreground">
            Any OpenAI-compatible endpoint (OpenAI, LiteLLM, vLLM, custom
            gateway, …).
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="llm-api-key">API Key</Label>
          <Input
            id="llm-api-key"
            type="password"
            placeholder="sk-..."
            value={local.apiKey}
            onChange={e =>
              setLocal(prev => ({ ...prev, apiKey: e.target.value }))
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="llm-model">Model</Label>
          <Input
            id="llm-model"
            placeholder="gpt-4o-mini"
            value={local.model}
            onChange={e =>
              setLocal(prev => ({ ...prev, model: e.target.value }))
            }
          />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button onClick={handleSave} disabled={!dirty}>
          Save
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            clear();
            setLocal({
              baseUrl: 'https://api.openai.com/v1',
              apiKey: '',
              model: 'gpt-4o-mini',
            });
          }}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
