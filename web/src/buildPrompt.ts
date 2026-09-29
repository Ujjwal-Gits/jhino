/** Instructions an AI coding tool can follow to make an app that works well in Jhino. Mirrors docs/BUILD_FOR_JHINO.md. */
export const BUILD_PROMPT = `Build (or adapt) this app to run inside Jhino, a self-hosted home for small web apps.

Package
- One index.html file, or a .zip with index.html at the top plus its css/js/images.
- Browser code only (HTML, CSS, JavaScript). No server code, no build step on the server.
- Prefer bundling libraries inside the file or zip. CDN scripts work but need internet access.

Saving data (pick one)
1. Simple: keep all shared data in localStorage as JSON. Jhino saves every localStorage
   key on its server and syncs it live to everyone who has the app.
   - Store lists as arrays of objects that each have a stable "id" field
     (for example crypto.randomUUID()). Jhino merges edits from different people by id.
   - Listen for changes so the screen updates without a reload:
       window.addEventListener('storage', () => { state = load(); render(); });
   - Keys meant for one person only (theme, last tab) can be marked private by the owner.
   - To show who added an item, save the author with it: const me = await jhino.me();
     item.by = { id: me.id, name: me.name, username: me.username }. Show "name (@username)".
2. Records API (best for bigger apps): window.jhino is available automatically.
       await jhino.ready();
       const me = await jhino.me();                       // { id, name, username, email, role }
       const { items, next } = await jhino.data.list('tasks', { limit: 50, after });
       const task = await jhino.data.create('tasks', { title: 'Hello', done: false });
       await jhino.data.update('tasks', task.id, { done: true }, { expectedRevision: task.revision });
       await jhino.data.delete('tasks', task.id);
       const stop = await jhino.data.subscribe('tasks', (change) => refetch());
   Records: { id, data, revision, createdBy, createdAt, updatedBy, updatedAt }.
   Files (photos, PDFs, videos up to 2 GB):
       const f = await jhino.files.upload(file, { onProgress: ({ loaded, total }) => {} });
       // f = { id, name, type, size, url, downloadUrl }; store f.id in a record field
       img.src = jhino.files.url(f.id);   // videos stream and can seek
       await jhino.files.delete(f.id);
   People who can open the app: await jhino.people()  ->  [{ id, name, username, role }]
   Show who added each item: find record.createdBy in jhino.people() and print "name (@username)".
   Optional manifest (lets the server check every save):
       <script type="application/json" id="jhino-manifest">
       { "specVersion": 1, "collections": { "tasks": { "fields": {
         "title": { "type": "text", "required": true }, "done": { "type": "boolean" } } } } }
       </script>
   Field types: text, longtext, number, money (whole paisa/cents), boolean, date, time, datetime,
   select (with "options"), url, email, phone, user, file, files, json. "protected": true means
   only editors can change it; collection "visibility": "own" shows people only their own items.
   Errors have err.code: FORBIDDEN (viewer), VALIDATION_FAILED, REVISION_CONFLICT
   (err.current holds the latest record: show it, keep the user's draft), QUOTA_EXCEEDED,
   CONNECTION_LOST. Collection names: letters, numbers, - and _.

Rules
- IndexedDB works and is saved and synced too (each record is saved on the server). Do not use cookies or sessionStorage for data that must be shared.
- Viewers can read but not change shared data; show a friendly message on FORBIDDEN.
- Do not build your own login or put any ID or password in the code. Jhino signs people in (on
  jhino.com, and on the app's own domain with the email and password logins the owner makes there) and the
  app runs as that person.
  Greet them and adapt to their access with the signed-in person:
      const u = jhino.user;   // { name, username, role, signedIn }  role: owner, editor, contributor, viewer
      hello.textContent = 'Hi, ' + u.name;
      if (u.role === 'viewer') hideEditButtons();
  On a custom domain with sign-in, add a sign-out button: button.onclick = () => jhino.signOut();
  (jhino.signOut() resolves false where there is nothing to sign out of: hide the button then.)
- Do not call Jhino URLs yourself; use window.jhino and localStorage.
- Works in any modern browser, on phones and desktops.`;
