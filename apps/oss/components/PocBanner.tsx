'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'agentscript-poc-banner-dismissed';

export default function PocBanner() {
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const onDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  if (!mounted || dismissed) return null;

  return (
    <div
      className="poc-banner"
      role="region"
      aria-label="Proof of concept notice"
    >
      <div className="poc-banner-inner">
        <span className="poc-banner-tag">POC</span>
        <span className="poc-banner-text">
          AgentScript OSS is an early proof of concept. Expect rough edges.
        </span>
        <button
          type="button"
          className="poc-banner-dismiss"
          aria-label="Dismiss POC notice"
          onClick={onDismiss}
        >
          ×
        </button>
      </div>
    </div>
  );
}
