import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AuthResponse, User } from '../lib/types';

const ME_KEY = ['auth', 'me'] as const;

// Fetches the current session. Does NOT redirect on 401 (returns null instead),
// so route guards can decide what to do.
export function useMe() {
  return useQuery<User | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        const res = await api.get<AuthResponse>('/auth/me', { noAuthRedirect: true });
        return res.user;
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (creds: { username: string; password: string }) =>
      api.post<AuthResponse>('/auth/login', creds, { noAuthRedirect: true }),
    onSuccess: (data) => {
      qc.setQueryData(ME_KEY, data.user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSuccess: () => {
      qc.setQueryData(ME_KEY, null);
      qc.clear();
    },
  });
}
