// Mirrors the server's util/validate.ts name rule (see SPEC.md): usernames,
// share names, group names.
export const NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,31}$/;
