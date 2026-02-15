import type { Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';

interface CallbackUser {
  id: string;
  email?: string;
  name?: string;
  image?: string;
}

export function getCallbacks() {
  return {
    async session({ session, token }: { session: Session; token: JWT }) {
      // Add user ID from token to session
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
    async jwt({ token, user }: { token: JWT; user?: CallbackUser }) {
      // Add user ID to token on sign in
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
  };
}