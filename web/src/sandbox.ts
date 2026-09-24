// Must match SANDBOX in server/apps.ts. Never add allow-same-origin: the app would
// then run with Jhino's own origin and could read the signed-in session.
export const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads';
