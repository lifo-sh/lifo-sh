'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error);
      return;
    }

    router.push('/login');
  }

  return (
    <main style={styles.container}>
      <h1 style={styles.title}>Create your Lifo account</h1>
      <form onSubmit={handleSubmit} style={styles.form}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          style={styles.input}
        />
        <input
          type="password"
          placeholder="Password (min 8 chars)"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          style={styles.input}
        />
        {error && <p style={styles.error}>{error}</p>}
        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? 'Creating account...' : 'Sign up'}
        </button>
        <p style={styles.link}>
          Already have an account? <a href="/login">Log in</a>
        </p>
      </form>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { fontFamily: 'monospace', padding: '2rem', maxWidth: '400px', margin: '4rem auto' },
  title: { marginBottom: '1.5rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  input: { padding: '0.5rem', fontSize: '14px', fontFamily: 'monospace' },
  button: { padding: '0.6rem', fontSize: '14px', cursor: 'pointer', fontFamily: 'monospace' },
  error: { color: 'red', fontSize: '13px', margin: 0 },
  link: { fontSize: '13px', color: 'gray' },
};
