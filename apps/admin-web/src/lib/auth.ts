import { createAuthClient } from 'better-auth/client';

const AUTH_BASE_URL = 'http://localhost:8787/api/auth';

export type AdminSessionResult = {
  session: {
    id: string;
    expiresAt: string;
  };
  user: {
    id: string;
    email: string;
    name: string;
  };
} | null;

export const adminAuthClient = createAuthClient({
  baseURL: AUTH_BASE_URL,
});

export async function getAdminSession() {
  const response = await fetch(`${AUTH_BASE_URL}/get-session`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to get admin session');
  }

  return (await response.json()) as AdminSessionResult;
}
