import GitHub from 'next-auth/providers/github';

export function getGitHubProvider() {
  return GitHub({
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    allowDangerousEmailAccountLinking: true,
  });
}