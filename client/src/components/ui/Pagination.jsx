export default function Pagination({ page, totalPages, onChange }) {
  const safeTotalPages = Math.max(1, totalPages);

  const pageSet = new Set([1, safeTotalPages, page, page - 1, page + 1].filter((p) => p >= 1 && p <= safeTotalPages));
  const sortedPages = [...pageSet].sort((a, b) => a - b);

  const items = [];
  let prevPage = 0;
  for (const p of sortedPages) {
    if (prevPage && p - prevPage > 1) items.push(<span className="cp-ellipsis" key={`e${p}`}>…</span>);
    items.push(
      <button key={p} className={p === page ? 'active' : ''} onClick={() => onChange(p)}>
        {p}
      </button>
    );
    prevPage = p;
  }

  return (
    <div id="contacts-pagination" className="contacts-pagination" style={{ display: 'flex' }}>
      <button onClick={() => onChange(page - 1)} disabled={page <= 1}>‹ Previous</button>
      {items}
      <button onClick={() => onChange(page + 1)} disabled={page >= safeTotalPages}>Next ›</button>
    </div>
  );
}
