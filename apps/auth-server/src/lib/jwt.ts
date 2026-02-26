import { SignJWT, jwtVerify } from 'jose';

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-me-in-production'
);

export interface CliTokenPayload {
  userId: string;
  email: string;
}

export async function signCliToken(payload: CliTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);
}

export async function verifyCliToken(token: string): Promise<CliTokenPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as CliTokenPayload;
}
