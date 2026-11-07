// Fenêtre modale Vert-ardoise : en-tête en dégradé + halo, déplaçable, fond assombri sans flou.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import useDraggable from '../useDraggable';

/**
 * props : open, onClose, title, icon (composant lucide), width (px), bodyClassName, children
 */
export default function Modal({ open, onClose, title, icon: Icon, width = 560, bodyClassName = '', children }) {
  const { boxRef, boxStyle, handleProps, reset } = useDraggable();

  useEffect(() => { if (open) reset(); }, [open, reset]); // recentrée à chaque ouverture
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="tk-portal tk-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={boxRef} className="tk-modal" style={{ ...boxStyle, maxWidth: width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="tk-modal-header" {...handleProps}>
          {Icon && <Icon size={18} />}
          <h2>{title}</h2>
          {onClose && <button type="button" onClick={onClose} aria-label="Fermer"><X size={18} /></button>}
        </div>
        <div className={`tk-modal-body ${bodyClassName}`}>{children}</div>
      </div>
    </div>,
    document.body
  );
}
