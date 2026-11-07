// Liste des livreurs (triée par distance si disponible).
export default function LivreurList({ livreurs, selectedId, onSelect, onChat }) {
  if (!livreurs.length) return <p className="p-4 text-center text-sm text-gray-500">Aucun livreur en ligne pour le moment.</p>;
  return (
    <ul className="divide-y">
      {livreurs.map((l, i) => (
        <li key={l.id}
          className={`flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50 ${selectedId === l.id ? 'bg-brand-light' : ''}`}
          onClick={() => onSelect?.(l)}>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{l.name}</p>
            <p className="text-xs text-gray-500">
              {l.distance_km != null ? `${l.distance_km} km` : ''} · {l.status === 'en_livraison' ? 'En livraison' : 'Disponible'}
            </p>
          </div>
          {onChat && (
            <button onClick={(e) => { e.stopPropagation(); onChat(l); }} className="btn-ghost px-2 py-1 text-sm">💬</button>
          )}
        </li>
      ))}
    </ul>
  );
}
