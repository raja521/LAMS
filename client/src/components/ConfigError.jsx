/** Shown when a required VITE_* setting is missing — plain HTML, no theme needed. */
export default function ConfigError({ message }) {
  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 640,
        margin: '15vh auto',
        padding: '0 24px',
        color: '#1b1b1b',
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>LAMS cannot start</h1>
      <pre
        style={{
          background: '#fff4f4',
          border: '1px solid #f2c1c1',
          borderRadius: 8,
          padding: 16,
          whiteSpace: 'pre-wrap',
          fontSize: 14,
        }}
      >
        {message}
      </pre>
      <p style={{ fontSize: 14, color: '#555' }}>
        Copy <code>.env.example</code> to <code>.env</code> inside the <code>client</code> folder, set the value,
        then restart the dev server.
      </p>
    </div>
  );
}
