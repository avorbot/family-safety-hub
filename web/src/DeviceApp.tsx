import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage, formatMinutes, formatTime, today, type DeviceMe, type Notice } from './api';
import { Brand, Card, ErrorText, NoticePanel, TimeMeter, UsageList } from './ui';

const TOKEN_KEY = 'fsh_device_token';

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be unavailable (private mode); the device just has to pair again next time.
  }
}

type State =
  | { kind: 'loading' }
  | { kind: 'unpaired' }
  | { kind: 'notice'; notice: Notice; childName?: string }
  | { kind: 'ready'; me: DeviceMe };

/** The page a child's device shows. Everything the parent sees is visible here too. */
export function DeviceApp() {
  const [token, setToken] = useState<string | null>(readToken);
  const [state, setState] = useState<State>({ kind: token ? 'loading' : 'unpaired' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return setState({ kind: 'unpaired' });
    try {
      setState({ kind: 'ready', me: await api<DeviceMe>(`/device/me?day=${today()}`, { token }) });
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        writeToken(null);
        setToken(null);
        setState({ kind: 'unpaired' });
      } else if (err instanceof ApiError && err.body.code === 'acknowledgement_required') {
        setState({ kind: 'notice', notice: err.body.notice as Notice });
      } else {
        setError(errorMessage(err));
      }
    }
  }, [token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <>
      <Brand />
      <main className="device">
        <ErrorText error={error} />
        {state.kind === 'unpaired' && (
          <PairForm
            onPaired={(newToken, notice, childName) => {
              writeToken(newToken);
              setToken(newToken);
              setState({ kind: 'notice', notice, childName });
            }}
          />
        )}
        {state.kind === 'notice' && token && (
          <AcknowledgeNotice
            notice={state.notice}
            childName={state.childName}
            onAcknowledged={async () => {
              await api('/device/acknowledge', { method: 'POST', token });
              await load();
            }}
          />
        )}
        {state.kind === 'ready' && token && <DeviceHome me={state.me} token={token} reload={load} />}
      </main>
    </>
  );
}

function PairForm({ onPaired }: { onPaired: (token: string, notice: Notice, childName: string) => void }) {
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const res = await api<{ token: string; notice: Notice; childName: string }>('/device/pair', {
        body: { code, ...(deviceName ? { deviceName } : {}) },
      });
      onPaired(res.token, res.notice, res.childName);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card title="Connect this device">
      <p className="muted">Ask your parent for the pairing code shown in their Family Safety Hub dashboard.</p>
      <form onSubmit={submit} className="stack">
        <label>
          Pairing code
          <input
            required
            autoCapitalize="characters"
            autoComplete="off"
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </label>
        <label>
          Device name (optional)
          <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
        </label>
        <ErrorText error={error} />
        <button className="primary">Continue</button>
      </form>
    </Card>
  );
}

function AcknowledgeNotice({
  notice,
  childName,
  onAcknowledged,
}: {
  notice: Notice;
  childName?: string;
  onAcknowledged: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title={notice.title}>
      {childName && <p>Hi {childName}! Before this device shares anything, here is exactly what that means.</p>}
      <NoticePanel notice={notice} />
      <ErrorText error={error} />
      <button
        className="primary"
        onClick={() => onAcknowledged().catch((err: unknown) => setError(errorMessage(err)))}
      >
        I’ve read this
      </button>
      <p className="muted small">Nothing is shared from this device until you press the button above.</p>
    </Card>
  );
}

function DeviceHome({ me, token, reload }: { me: DeviceMe; token: string; reload: () => Promise<void> }) {
  const [showNotice, setShowNotice] = useState(false);
  return (
    <div className="stack-lg">
      <h1>Hi {me.childName}</h1>
      <Card title="Today">
        <TimeMeter policy={me.policy} />
        <UsageList usage={me.usage} />
      </Card>
      <RequestTime token={token} reload={reload} me={me} />
      <CheckInCard token={token} reload={reload} me={me} />
      <LogActivity token={token} reload={reload} />
      <Card
        title="What your parent can see"
        actions={<button onClick={() => setShowNotice(!showNotice)}>{showNotice ? 'Hide' : 'Show'}</button>}
      >
        {showNotice ? (
          <NoticePanel notice={me.notice} />
        ) : (
          <p className="muted small">
            Usage totals, your limits, time requests and check-ins. Never messages, keystrokes or location.
          </p>
        )}
        {me.policy.blockedDomains.length > 0 && (
          <p className="small">
            <strong>Blocked sites:</strong> {me.policy.blockedDomains.join(', ')}
          </p>
        )}
      </Card>
    </div>
  );
}

function RequestTime({ token, reload, me }: { token: string; reload: () => Promise<void>; me: DeviceMe }) {
  const [minutes, setMinutes] = useState(15);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api('/device/time-requests', { token, body: { day: today(), minutes, reason } });
      setReason('');
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card title="Ask for more time">
      <form onSubmit={submit} className="stack">
        <div className="row">
          <label>
            Minutes
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[15, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="grow">
            Why?
            <input required maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
        <ErrorText error={error} />
        <button className="primary">Send request</button>
      </form>
      <ul className="list">
        {me.timeRequests.map((r) => (
          <li key={r.id}>
            <div>
              {formatMinutes(r.minutes)}: “{r.reason}”<div className="muted small">{formatTime(r.createdAt)}</div>
            </div>
            <span className={`tag tag-${r.status}`}>{r.status}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CheckInCard({ token, reload, me }: { token: string; reload: () => Promise<void>; me: DeviceMe }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const last = me.checkIns[0];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api('/device/check-ins', { token, body: { message } });
      setMessage('');
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card title="Check in">
      <form onSubmit={submit} className="row">
        <input
          aria-label="Check-in message"
          placeholder="e.g. Got to Sam's house"
          required
          maxLength={280}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button className="primary">Send</button>
      </form>
      <ErrorText error={error} />
      {last && (
        <p className="muted small">
          Last check-in: “{last.message}” · {formatTime(last.createdAt)}
        </p>
      )}
    </Card>
  );
}

/**
 * A device agent would report usage automatically. Until one exists, activity can be added by
 * hand here, which is also how to try the app end to end.
 */
function LogActivity({ token, reload }: { token: string; reload: () => Promise<void> }) {
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('app');
  const [minutes, setMinutes] = useState(15);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api('/device/usage', { token, body: { day: today(), entries: [{ label, category, minutes }] } });
      setLabel('');
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card title="Add activity">
      <form onSubmit={submit} className="row wrap">
        <input aria-label="App or website" placeholder="App or website" required value={label} onChange={(e) => setLabel(e.target.value)} />
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          {['app', 'website', 'game', 'video', 'other'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input
          aria-label="Minutes"
          type="number"
          min={1}
          max={1440}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          className="narrow"
        />
        <button>Add</button>
      </form>
      <ErrorText error={error} />
    </Card>
  );
}
