import { useEffect, type ReactNode } from 'react';

// proxsyno's UI is dark-only (DSM desktop shell, per docs/ui-conventions.md).
// The provider just pins the `dark` class so every `dark:` variant applies.
export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);
  return <>{children}</>;
}
