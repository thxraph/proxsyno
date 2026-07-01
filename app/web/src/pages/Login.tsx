import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardDrive, Loader2, Lock, User as UserIcon } from 'lucide-react';
import { ApiError, errMsg } from '../api/client';
import { useLogin, useMe } from '../hooks/useAuth';

function nextTarget(): string {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  // Only allow internal relative paths.
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/';
}

export function Login() {
  const navigate = useNavigate();
  const login = useLogin();
  const { data: me } = useMe();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  // If already authenticated, bounce to the app.
  useEffect(() => {
    if (me) navigate(nextTarget(), { replace: true });
  }, [me, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ username: username.trim(), password });
      navigate(nextTarget(), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403)
        setError('This account is not permitted to sign in.');
      else if (err instanceof ApiError && err.status === 401)
        setError('Incorrect username or password.');
      else setError(errMsg(err, 'Unable to sign in. Please try again.'));
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-600 text-white shadow-lg">
            <HardDrive className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              proxsyno
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Sign in to manage your NAS
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          <div>
            <label htmlFor="username" className="label">
              Username
            </label>
            <div className="relative">
              <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="username"
                name="username"
                autoComplete="username"
                autoFocus
                required
                className="input pl-9"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="root"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="input pl-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={login.isPending || !username || !password}
          >
            {login.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          Authenticates against the host via PAM. Only administrators may sign in.
        </p>
      </div>
    </div>
  );
}
