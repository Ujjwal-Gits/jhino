import { useEffect, useState } from 'react';
import { ApiError, api, get } from './api';
import { INTERESTS, appsForInterests, type InterestState } from './appsPrefs';
import { Modal, useToast } from './ui';

/** The short welcome after sign-up: "What will you use Jhino for?" Skippable, once per account, reopened from Account settings. */
export function Welcome({ onClose, onSaved }: { onClose: () => void; onSaved?: (interests: string[]) => void }) {
  const toast = useToast();
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { get<InterestState>('/api/home/interests').then((r) => setPick(r.interests), () => {}); }, []);
  const flip = (k: string) => setPick((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const save = async (interests: string[]) => {
    setBusy(true);
    try {
      await api('PUT', '/api/home/interests', { interests });
      if (interests.length) {
        // Seed Home from the interests, only when the person has no pins yet.
        const cur = await get<{ ids: string[] | null }>('/api/home/apps').catch(() => null);
        if (cur && cur.ids === null) await api('PUT', '/api/home/apps', { ids: appsForInterests(interests) });
      }
      onSaved?.(interests);
      window.dispatchEvent(new Event('jhino-home-apps'));
      onClose();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save that.', true); setBusy(false); }
  };
  return (
    <Modal title="Welcome to Jhino" onClose={onClose} footer={<>
      <button className="btn quiet" disabled={busy} onClick={() => save([])}>Skip</button>
      <button className="btn primary" disabled={busy || !pick.length} onClick={() => save(pick)}>Continue</button>
    </>}>
      <div className="modal-body">
        <h3 className="wl-q">What will you use Jhino for?</h3>
        <p className="hint">Pick as many as you like. We will put the right apps first on Home.</p>
        <div className="wl-chips" role="group" aria-label="What you will use Jhino for">
          {INTERESTS.map((i) => (
            <button key={i.key} type="button" className="wl-chip" aria-pressed={pick.includes(i.key)} onClick={() => flip(i.key)}>{i.label}</button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
