import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiKeys, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import TokenDisplay from './TokenDisplay';

export default async function CliAuthPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect('/login?callbackUrl=/auth/cli');
  }

  // Always verify user exists in DB by email
  const [dbUser] = await db.select().from(users).where(eq(users.email, session.user.email!)).limit(1);

  if (!dbUser) redirect('/register');

  const userId = dbUser.id;

  // Reuse existing key or create a new one
  let [existing] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .limit(1);

  if (!existing) {
    const key = `lifo_${nanoid(32)}`;
    [existing] = await db
      .insert(apiKeys)
      .values({ userId, key, name: 'cli' })
      .returning();
  }

  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Lifo CLI Login</h1>
      <p>Logged in as <strong>{session.user.email}</strong></p>
      <p>Copy this API key and paste it into your terminal:</p>
      <TokenDisplay token={existing.key} />
      <p style={{ color: 'gray', fontSize: '12px' }}>You can close this tab after copying.</p>
    </main>
  );
}
