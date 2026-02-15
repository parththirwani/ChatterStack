import Google from 'next-auth/providers/google';

export function getGoogleProvider() {
  return Google({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    allowDangerousEmailAccountLinking: true,
  });
}