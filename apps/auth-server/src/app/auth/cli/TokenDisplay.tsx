'use client';

export default function TokenDisplay({ token }: { token: string }) {
  return (
    <textarea
      readOnly
      rows={6}
      style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px', padding: '0.5rem' }}
      value={token}
      onClick={(e) => (e.target as HTMLTextAreaElement).select()}
    />
  );
}
