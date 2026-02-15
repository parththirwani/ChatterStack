import type { Session } from 'next-auth';
import type { User as NextAuthUser } from 'next-auth';

export function getCallbacks() {
  return {
    async session({ session, user }: { session: Session; user: NextAuthUser }) {
      if (session.user && user?.id) {
        session.user.id = user.id;
      }
      return session;
    },
  };
}