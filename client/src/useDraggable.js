// Hook commun : fenêtre déplaçable en tirant son en-tête.
// - pointer events (souris + tactile), déplacement par transform: translate
// - les boutons de l'en-tête restent cliquables (on ignore les clics sur button/a/input)
// - la fenêtre ne peut pas sortir de l'écran : 40 px restent toujours visibles
// - reset() recentre la fenêtre (appelé à chaque ouverture)
import { useCallback, useRef, useState } from 'react';

const KEEP_VISIBLE = 40;

export default function useDraggable() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const boxRef = useRef(null);
  const drag = useRef(null);

  const onPointerDown = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('button, a, input, select, textarea, [data-no-drag]')) return;
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    drag.current = { startX: e.clientX, startY: e.clientY, base: { ...offset }, box };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }, [offset]);

  const onPointerMove = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    let dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    // Bornes : au moins 40 px de la fenêtre restent dans l'écran
    const vw = window.innerWidth, vh = window.innerHeight;
    dx = Math.min(Math.max(dx, KEEP_VISIBLE - d.box.right), vw - KEEP_VISIBLE - d.box.left);
    dy = Math.min(Math.max(dy, -d.box.top), vh - KEEP_VISIBLE - d.box.top);
    setOffset({ x: d.base.x + dx, y: d.base.y + dy });
  }, []);

  const onPointerUp = useCallback((e) => {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  const reset = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  return {
    boxRef,
    boxStyle: { transform: `translate(${offset.x}px, ${offset.y}px)` },
    handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
    reset
  };
}
