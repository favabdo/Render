export default function MediaLightbox({ url, onClose }) {
  if (!url) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out',
      }}
    >
      <img src={url} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }} />
    </div>
  );
}
