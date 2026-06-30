// authenticate-pam is a native addon shipped without TypeScript types.
// It is loaded via dynamic import() in src/auth/pam.ts and cast to a concrete
// signature there; this ambient declaration just lets tsc resolve the module.
declare module "authenticate-pam";
