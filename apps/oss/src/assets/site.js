import { applyHighlighting } from './highlight.js';

applyHighlighting();

// Copy-to-clipboard for every <pre> with a data-source.
const toast = document.createElement('div');
toast.className = 'toast';
toast.textContent = 'Copied';
document.body.appendChild(toast);

let toastTimer = null;
function flashToast(message = 'Copied') {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1200);
}

for (const pre of document.querySelectorAll('pre')) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy';
  button.textContent = 'Copy';
  button.setAttribute('aria-label', 'Copy code');
  pre.appendChild(button);
  button.addEventListener('click', async () => {
    const src =
      pre.dataset.source ?? pre.querySelector('code')?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(src);
      flashToast('Copied');
    } catch {
      flashToast('Copy failed');
    }
  });
}

// Sticky-header shadow on scroll.
const header = document.querySelector('.site-header');
if (header) {
  const onScroll = () => {
    header.classList.toggle('scrolled', window.scrollY > 4);
  };
  document.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}
