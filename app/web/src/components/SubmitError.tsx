// Red banner for a failed form submission (rendered above the form).
export function SubmitError({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
      {message}
    </div>
  );
}
