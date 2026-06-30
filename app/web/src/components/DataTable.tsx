import type { ReactNode } from 'react';
import { cx } from '../lib/format';

export interface Column<T> {
  key: string;
  header: ReactNode;
  // Render the cell. Receives the row.
  render: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
  align?: 'left' | 'right' | 'center';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: ReactNode;
  // Optional indentation level per row (used by the disk tree).
  rowDepth?: (row: T) => number;
  onRowClick?: (row: T) => void;
  className?: string;
}

const alignClass: Record<NonNullable<Column<unknown>['align']>, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = 'No items.',
  rowDepth,
  onRowClick,
  className,
}: DataTableProps<T>) {
  return (
    <div className={cx('card overflow-hidden', className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cx(
                    'px-4 py-3 font-medium',
                    c.align && alignClass[c.align],
                    c.headerClassName,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const depth = rowDepth ? rowDepth(row) : 0;
                return (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cx(
                      'border-b border-slate-100 last:border-0 dark:border-slate-800/70',
                      onRowClick && 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50',
                    )}
                  >
                    {columns.map((c, i) => (
                      <td
                        key={c.key}
                        className={cx(
                          'px-4 py-3 text-slate-700 dark:text-slate-200',
                          c.align && alignClass[c.align],
                          c.className,
                        )}
                        style={i === 0 && depth ? { paddingLeft: `${16 + depth * 20}px` } : undefined}
                      >
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
