'use client';

import { useEffect } from 'react';

export default function StickyHeader() {
  useEffect(() => {
    const header = document.querySelector('.site-header');
    if (!header) return;
    const onScroll = () => {
      header.classList.toggle('scrolled', window.scrollY > 4);
    };
    document.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => document.removeEventListener('scroll', onScroll);
  }, []);
  return null;
}
