import type { GuestRef, PveConfig } from '../../lib/types';
import { ConfigEditor, ReadOnlyKeys, type FieldDef } from './ConfigEditor';

// Common qemu OS types (mirrors Proxmox's set; loose).
const QEMU_OSTYPES = ['l26', 'l24', 'win11', 'win10', 'win8', 'win7', 'wxp', 'other', 'solaris'];

// Hardware device lines we surface read-only (qemu).
const QEMU_HW_RE = /^(net|scsi|ide|sata|virtio|usb|hostpci|serial)\d+$|^(scsihw|bootdisk|boot|ostype|bios|machine|vga|agent)$/;
// Resource/device lines we surface read-only (lxc).
const LXC_HW_RE = /^(net|mp)\d+$|^(rootfs|arch|ostype|unprivileged|features|swap)$/;

function splitKeys(config: PveConfig, editable: Set<string>, hwRe: RegExp) {
  const hardware: string[] = [];
  const raw: string[] = [];
  for (const k of Object.keys(config).sort()) {
    if (editable.has(k)) continue;
    if (k === 'digest') continue; // internal checksum, not useful to show
    if (hwRe.test(k)) hardware.push(k);
    else raw.push(k);
  }
  return { hardware, raw };
}

export function HardwareTab({ guest }: { guest: GuestRef }) {
  const isQemu = guest.type === 'qemu';
  const fields: FieldDef[] = isQemu
    ? [
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'cores', label: 'Cores', kind: 'number' },
        { key: 'memory', label: 'Memory (MB)', kind: 'number' },
        { key: 'onboot', label: 'Start at boot', kind: 'toggle' },
      ]
    : [
        { key: 'hostname', label: 'Hostname', kind: 'text' },
        { key: 'cores', label: 'Cores', kind: 'number' },
        { key: 'memory', label: 'Memory (MB)', kind: 'number' },
        { key: 'onboot', label: 'Start at boot', kind: 'toggle' },
      ];

  return (
    <ConfigEditor
      guest={guest}
      fields={fields}
      renderExtra={(config, editableKeys) => {
        const { hardware, raw } = splitKeys(config, editableKeys, isQemu ? QEMU_HW_RE : LXC_HW_RE);
        return (
          <div className="space-y-5">
            <ReadOnlyKeys
              title={isQemu ? 'Devices (read-only)' : 'Mounts & network (read-only)'}
              config={config}
              keys={hardware}
            />
            <ReadOnlyKeys title="Other config (read-only)" config={config} keys={raw} />
          </div>
        );
      }}
    />
  );
}

export function OptionsTab({ guest }: { guest: GuestRef }) {
  const isQemu = guest.type === 'qemu';
  const fields: FieldDef[] = [
    isQemu
      ? { key: 'name', label: 'Name', kind: 'text' }
      : { key: 'hostname', label: 'Hostname', kind: 'text' },
    { key: 'onboot', label: 'Start at boot', kind: 'toggle' },
    { key: 'protection', label: 'Protection', kind: 'toggle', hint: 'Block destructive actions.' },
    {
      key: 'startup',
      label: 'Startup/shutdown order',
      kind: 'text',
      placeholder: 'order=1,up=30,down=60',
      hint: 'Proxmox startup string.',
    },
  ];
  if (isQemu) {
    fields.push({ key: 'ostype', label: 'OS type', kind: 'select', options: QEMU_OSTYPES });
  }
  return <ConfigEditor guest={guest} fields={fields} />;
}
