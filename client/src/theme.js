// Mode clair / sombre : attribut data-theme sur <html>, mémorisé en localStorage.
// (Appliqué avant le premier rendu par le script inline de index.html.)
import { useEffect, useState } from 'react';

const KEY = 'tk-theme';
const read = () => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

export function useTheme() {
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch { /* stockage indisponible */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

/** Barre latérale rabattue : classe sur <html>, mémorisée en localStorage */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('tk-sidebar') === 'collapsed'; } catch { return false; }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('tk-sidebar-collapsed', collapsed);
    try { localStorage.setItem('tk-sidebar', collapsed ? 'collapsed' : 'open'); } catch { /* ignoré */ }
  }, [collapsed]);
  return [collapsed, () => setCollapsed((c) => !c)];
}
