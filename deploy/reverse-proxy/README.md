# TLS reverse proxy for proxsyno

proxsyno listens on plain HTTP on `:8800`. Terminate TLS in front of it and it
becomes fully hardened. Pick one:

| File | When |
|---|---|
| [`Caddyfile`](./Caddyfile) | Easiest — Caddy auto-provisions and renews certs (public domain **or** a local CA for LAN names). |
| [`nginx-proxsyno.conf`](./nginx-proxsyno.conf) | You already run nginx / prefer certbot. |

Both are pre-configured for proxsyno's specifics:

- **WebSocket upgrades** — the consoles (`/ws/pve/console`, `/ws/proxmox/console`)
  and the live stats stream (`/ws/system`) are proxied and kept open.
- **Real client IP** forwarded — proxsyno's per-IP brute-force lockout depends on
  it, so an attacker can't lock out every user by sharing the proxy's IP.
- **Host header preserved** — the CSRF Origin==Host check and the `__Host-` cookie
  need it.
- **5 GiB upload size** — matches the default `MAX_UPLOAD_BYTES`.

## The one required follow-up

After the proxy is serving HTTPS, put proxsyno into HTTPS mode:

```bash
echo 'COOKIE_SECURE=true' | sudo tee -a /etc/proxsyno/proxsyno.env
sudo systemctl restart proxsyno
```

That flips on three things at once: the **Secure** session cookie, the
**`__Host-`** cookie prefix (host-pinned), and **HSTS**. Leave `COOKIE_SECURE`
unset/`false` only while you're still on plain HTTP — a Secure cookie is dropped
by browsers over `http://` and login would silently fail.
