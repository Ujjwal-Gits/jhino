import { useState, type FormEvent } from 'react';
import { ApiError, post } from './api';
import { Icon, Modal } from './ui';

/** Request a feature or send feedback without leaving the page (goes to Super Admin → Support). */
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState('');
  const send = async (e: FormEvent) => {
    e.preventDefault(); setState('busy'); setError('');
    try { await post('/api/support', { kind: 'feedback', subject: subject.trim(), message: message.trim() }); setState('sent'); }
    catch (x) { setError(x instanceof ApiError ? x.message : 'Could not send. Try again.'); setState('idle'); }
  };
  if (state === 'sent') return (
    <Modal title="Thank you" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="modal-body fb-sent"><Icon name="check" size={22} /><p>We read every request. If we build it, you'll hear from us in your notifications.</p></div>
    </Modal>
  );
  return (
    <Modal title="Request a feature" onClose={onClose} footer={<>
      <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
      <button type="submit" form="fb-form" className="btn primary" disabled={state === 'busy' || !subject.trim() || message.trim().length < 5}>{state === 'busy' && <span className="spin" />}Send</button>
    </>}>
      <form id="fb-form" className="modal-body" onSubmit={send}>
        <label className="field"><span>What should Jhino do?</span><input className="input" required maxLength={140} autoFocus value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="For example: send invoices from an app" /></label>
        <label className="field"><span>Tell us more</span><textarea className="textarea" required rows={5} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What are you trying to do, and how would this help?" /></label>
        {error && <p className="error-text" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
