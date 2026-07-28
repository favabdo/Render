export default function RouteLoader() {
  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100vh',
        background: 'var(--bg, #f0f2f5)',
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          border: '3px solid rgba(108,92,231,0.15)',
          borderTopColor: '#6C5CE7',
          borderRadius: '50%',
          animation: 'iw-spin .7s linear infinite',
        }}
      />
    </div>
  );
}
