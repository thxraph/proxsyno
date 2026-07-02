import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Send } from 'lucide-react';
import type { NotificationSettings, Severity } from '../../lib/types';
import { api, errMsg } from '../../api/client';
import { Modal } from '../Modal';
import { FormField } from '../FormField';
import { SubmitError } from '../SubmitError';
import { Toggle } from '../../pages/Shares';
import { cx } from '../../lib/format';

const SEVERITIES: Severity[] = ['info', 'warning', 'critical'];

interface TestResult {
  sink: string;
  ok: boolean;
  error?: string;
}

export function NotificationSettingsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['notifications', 'settings'],
    queryFn: () => api.get<NotificationSettings>('/notifications/settings'),
  });

  const [form, setForm] = useState<NotificationSettings | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [results, setResults] = useState<TestResult[] | null>(null);

  // Prefill local state once settings load.
  useEffect(() => {
    if (q.data && !form) setForm(structuredClone(q.data));
  }, [q.data, form]);

  const save = useMutation({
    mutationFn: (payload: NotificationSettings) =>
      api.put<NotificationSettings>('/notifications/settings', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      onClose();
    },
    onError: (e) => setSubmitError(errMsg(e, 'Failed to save settings')),
  });

  const test = useMutation({
    mutationFn: () => api.post<{ results: TestResult[] }>('/notifications/test'),
    onSuccess: (r) => setResults(r.results),
    onError: (e) => setSubmitError(errMsg(e, 'Failed to send test')),
  });

  const busy = save.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Save className="h-4 w-4 text-orange-400" aria-hidden />
          Notification settings
        </span>
      }
      busy={busy}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              setSubmitError(null);
              if (form) save.mutate(form);
            }}
            disabled={busy || !form}
          >
            <Save className="h-4 w-4" aria-hidden />
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {q.isLoading && <p className="text-sm text-zinc-400">Loading settings…</p>}
      {q.isError && <SubmitError message={errMsg(q.error, 'Failed to load settings')} />}

      {form && (
        <>
          {submitError && <SubmitError message={submitError} />}

          <FormField
            label="Minimum severity"
            hint="Only send alerts at or above this level."
          >
            <select
              className="input"
              value={form.minSeverity}
              onChange={(e) =>
                setForm({ ...form, minSeverity: e.target.value as Severity })
              }
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FormField>

          <div className="flex gap-3">
            <FormField label="Disk usage alert (%)" className="flex-1">
              <input
                className="input"
                type="number"
                min={1}
                max={100}
                value={form.thresholds.diskPct}
                onChange={(e) =>
                  setForm({
                    ...form,
                    thresholds: { ...form.thresholds, diskPct: Number(e.target.value) },
                  })
                }
              />
            </FormField>
            <FormField label="Temperature alert (°C)" className="flex-1">
              <input
                className="input"
                type="number"
                min={20}
                max={120}
                value={form.thresholds.tempC}
                onChange={(e) =>
                  setForm({
                    ...form,
                    thresholds: { ...form.thresholds, tempC: Number(e.target.value) },
                  })
                }
              />
            </FormField>
          </div>

          {/* ntfy */}
          <SinkSection
            title="ntfy"
            enabled={form.sinks.ntfy.enabled}
            onToggle={(v) =>
              setForm({ ...form, sinks: { ...form.sinks, ntfy: { ...form.sinks.ntfy, enabled: v } } })
            }
          >
            <FormField label="Server URL">
              <input
                className="input"
                value={form.sinks.ntfy.url}
                placeholder="https://ntfy.sh"
                onChange={(e) =>
                  setForm({ ...form, sinks: { ...form.sinks, ntfy: { ...form.sinks.ntfy, url: e.target.value } } })
                }
              />
            </FormField>
            <FormField label="Topic" className="mb-0">
              <input
                className="input"
                value={form.sinks.ntfy.topic}
                placeholder="proxsyno-alerts"
                onChange={(e) =>
                  setForm({ ...form, sinks: { ...form.sinks, ntfy: { ...form.sinks.ntfy, topic: e.target.value } } })
                }
              />
            </FormField>
          </SinkSection>

          {/* webhook */}
          <SinkSection
            title="Webhook"
            enabled={form.sinks.webhook.enabled}
            onToggle={(v) =>
              setForm({ ...form, sinks: { ...form.sinks, webhook: { ...form.sinks.webhook, enabled: v } } })
            }
          >
            <FormField label="POST URL" className="mb-0">
              <input
                className="input"
                value={form.sinks.webhook.url}
                placeholder="https://example.com/hook"
                onChange={(e) =>
                  setForm({ ...form, sinks: { ...form.sinks, webhook: { ...form.sinks.webhook, url: e.target.value } } })
                }
              />
            </FormField>
          </SinkSection>

          {/* telegram */}
          <SinkSection
            title="Telegram"
            enabled={form.sinks.telegram.enabled}
            onToggle={(v) =>
              setForm({ ...form, sinks: { ...form.sinks, telegram: { ...form.sinks.telegram, enabled: v } } })
            }
          >
            <FormField label="Bot token">
              <input
                className="input"
                value={form.sinks.telegram.botToken}
                onChange={(e) =>
                  setForm({ ...form, sinks: { ...form.sinks, telegram: { ...form.sinks.telegram, botToken: e.target.value } } })
                }
              />
            </FormField>
            <FormField label="Chat ID" className="mb-0">
              <input
                className="input"
                value={form.sinks.telegram.chatId}
                onChange={(e) =>
                  setForm({ ...form, sinks: { ...form.sinks, telegram: { ...form.sinks.telegram, chatId: e.target.value } } })
                }
              />
            </FormField>
          </SinkSection>

          {/* Test */}
          <div className="mt-4 border-t border-zinc-800 pt-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setSubmitError(null);
                  setResults(null);
                  test.mutate();
                }}
                disabled={test.isPending || busy}
              >
                <Send className="h-4 w-4" aria-hidden />
                {test.isPending ? 'Sending…' : 'Send test'}
              </button>
              {results && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {results.length === 0 ? (
                    <span className="text-zinc-400">No sinks enabled.</span>
                  ) : (
                    results.map((r) => (
                      <span
                        key={r.sink}
                        className={cx(r.ok ? 'text-emerald-400' : 'text-rose-400')}
                      >
                        {r.sink} {r.ok ? '✓' : `✗ ${r.error ?? ''}`}
                      </span>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

function SinkSection({
  title,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 rounded-lg bg-zinc-950 p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-200">{title}</span>
        <Toggle label="" checked={enabled} onChange={onToggle} />
      </div>
      {enabled && <div className="space-y-3">{children}</div>}
    </div>
  );
}
