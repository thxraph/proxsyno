import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cx } from '../lib/format';
import { useIsMobile } from '../hooks/useIsMobile';

// Above this many rows the list is windowed (only the visible slice is mounted)
// inside a bounded scroll box. At or below it, render exactly as before so the
// many small consumers keep their normal document flow and behaviour.
const VIRTUALIZE_THRESHOLD = 80;

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
  const isMobile = useIsMobile();
  const virtualize = rows.length > VIRTUALIZE_THRESHOLD;

  // A single scroll container + virtualizer serves whichever path renders. When
  // below threshold the bounded box isn't mounted, scrollRef stays null and the
  // virtualizer is inert — nothing is windowed.
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (isMobile ? 120 : 48),
    overscan: 12,
    measureElement: (el) => el?.getBoundingClientRect().height ?? 0,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtual = virtualItems[virtualItems.length - 1];
  const paddingTop = virtualItems[0]?.start ?? 0;
  const paddingBottom = virtualizer.getTotalSize() - (lastVirtual?.end ?? 0);

  // Per-row/card renderers shared by the virtualized and non-virtualized paths.
  const renderCard = (row: T) => {
    const depth = rowDepth ? rowDepth(row) : 0;
    return (
      <div
        onClick={onRowClick ? () => onRowClick(row) : undefined}
        style={depth ? { marginLeft: `${depth * 12}px` } : undefined}
        className={cx(
          'card divide-y divide-slate-100 dark:divide-slate-800/70',
          onRowClick && 'cursor-pointer active:bg-slate-50 dark:active:bg-slate-800/50',
        )}
      >
        {columns.map((c) => {
          const hasHeader = c.header !== null && c.header !== undefined && c.header !== '';
          return (
            <div key={c.key} className="flex items-start justify-between gap-3 px-3 py-2">
              {hasHeader && (
                <span className="shrink-0 pt-0.5 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {c.header}
                </span>
              )}
              <span
                className={cx(
                  'min-w-0 text-sm text-slate-700 dark:text-slate-200',
                  hasHeader ? 'text-right' : 'flex-1',
                )}
              >
                {c.render(row)}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderRow = (
    row: T,
    virtual?: { measureRef: (el: HTMLTableRowElement | null) => void; index: number },
  ) => {
    const depth = rowDepth ? rowDepth(row) : 0;
    return (
      <tr
        key={rowKey(row)}
        ref={virtual?.measureRef}
        data-index={virtual?.index}
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
  };

  // On phones a wide table forces horizontal scrolling. Render each row as a
  // stacked card of label/value pairs instead — the column header is the label,
  // the cell is the value. Columns with no header (e.g. an actions column) take
  // the full width.
  if (isMobile) {
    if (rows.length === 0) {
      return (
        <div className={cx('flex flex-col gap-2', className)}>
          <div className="card px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {emptyMessage}
          </div>
        </div>
      );
    }
    if (!virtualize) {
      return (
        <div className={cx('flex flex-col gap-2', className)}>
          {rows.map((row) => (
            <div key={rowKey(row)}>{renderCard(row)}</div>
          ))}
        </div>
      );
    }
    return (
      <div ref={scrollRef} className={cx('overflow-auto', className)} style={{ maxHeight: '70vh' }}>
        <div style={{ height: paddingTop }} />
        {virtualItems.map((v) => (
          <div
            key={rowKey(rows[v.index])}
            data-index={v.index}
            ref={virtualizer.measureElement}
            className="pb-2"
          >
            {renderCard(rows[v.index])}
          </div>
        ))}
        <div style={{ height: paddingBottom }} />
      </div>
    );
  }

  const table = (
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
        ) : !virtualize ? (
          rows.map((row) => renderRow(row))
        ) : (
          <>
            <tr style={{ height: paddingTop }}>
              <td colSpan={columns.length} />
            </tr>
            {virtualItems.map((v) =>
              renderRow(rows[v.index], { measureRef: virtualizer.measureElement, index: v.index }),
            )}
            <tr style={{ height: paddingBottom }}>
              <td colSpan={columns.length} />
            </tr>
          </>
        )}
      </tbody>
    </table>
  );

  if (virtualize && rows.length > 0) {
    return (
      <div className={cx('card overflow-hidden', className)}>
        <div ref={scrollRef} className="overflow-auto" style={{ maxHeight: '70vh' }}>
          {table}
        </div>
      </div>
    );
  }

  return (
    <div className={cx('card overflow-hidden', className)}>
      <div className="overflow-x-auto">{table}</div>
    </div>
  );
}
