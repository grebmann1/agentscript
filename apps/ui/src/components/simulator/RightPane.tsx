/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState } from 'react';
import { cn } from '~/lib/utils';

export interface RightPaneTab {
  id: string;
  label: string;
  /** Optional numeric badge shown next to the label. */
  badge?: number;
  content: React.ReactNode;
}

interface RightPaneProps {
  tabs: RightPaneTab[];
  defaultTab?: string;
}

/**
 * Tabs wrapper for the Simulator's right side. Accepts an arbitrary list of
 * tabs so callers can add / reorder them without editing this component.
 */
export function RightPane({ tabs, defaultTab }: RightPaneProps) {
  const [tabId, setTabId] = useState<string>(defaultTab ?? tabs[0]?.id ?? '');
  const active = tabs.find(t => t.id === tabId) ?? tabs[0];

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b">
        {tabs.map(t => (
          <TabButton
            key={t.id}
            active={t.id === active?.id}
            onClick={() => setTabId(t.id)}
            label={t.label}
            badge={t.badge && t.badge > 0 ? String(t.badge) : undefined}
          />
        ))}
      </div>
      <div className="flex-1 overflow-hidden">{active?.content}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative px-4 py-2 text-sm font-medium transition-colors',
        active
          ? 'text-foreground border-b-2 border-primary -mb-px'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
      {badge && (
        <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {badge}
        </span>
      )}
    </button>
  );
}
