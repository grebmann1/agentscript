'use client';

export default function CopyButton({ source }: { source: string }) {
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(source);
      flashToast('Copied');
    } catch {
      flashToast('Copy failed');
    }
  };

  return (
    <button
      type="button"
      className="copy"
      aria-label="Copy code"
      onClick={onClick}
    >
      Copy
    </button>
  );
}

let toastEl: HTMLDivElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function flashToast(message = 'Copied') {
  if (typeof document === 'undefined') return;
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl?.classList.remove('show'), 1200);
}
