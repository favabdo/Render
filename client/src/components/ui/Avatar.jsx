import { initialsFromName, avatarColorFor } from '../../utils/avatar';

export default function Avatar({ name, seed, size = 44, className = '', imageSrc = null }) {
  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        className={className}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        alt={name || ''}
      />
    );
  }

  const initials = initialsFromName(name);
  const color = avatarColorFor(seed || name);
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: Math.round(size * 0.38),
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}
