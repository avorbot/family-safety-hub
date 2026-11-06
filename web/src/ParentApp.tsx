import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  api,
  errorMessage,
  formatMinutes,
  formatTime,
  today,
  type Child,
  type Parent,
  type Summary,
} from './api';
import { Brand, Card, ErrorText, TimeMeter, UsageList } from './ui';

export function ParentApp() {
  const [parent, setParent] = useState<Parent | null | undefined>(undefined);

  useEffect(() => {
    api<{ parent: Parent }>('/auth/me')
      .then((res) => setParent(res.parent))
      .catch(() => setParent(null));
  }, []);

  if (parent === undefined) return <Brand />;
  if (parent === null) return <AuthScreen onSignedIn={setParent} />;
  return <Dashboard parent={parent} onSignedOut={() => setParent(null)} />;
}

function AuthScreen({ onSignedIn }: { onSignedIn: (parent: Parent) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = mode === 'login' ? { email: form.email, password: form.password } : form;
      const res = await api<{ parent: Parent }>(`/auth/${mode}`, { body });
      onSignedIn(res.parent);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Brand />
      <main className="auth">
        <h1>{mode === 'login' ? 'Welcome back' : 'Create a parent account'}</h1>
        <p className="muted">
          Set screen-time limits together with your kids. Their devices always show them what you can see.
        </p>
        <form onSubmit={submit} className="stack">
          {mode === 'register' && (
            <label>
              Your name
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={mode === 'register' ? 10 : 1}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <ErrorText error={error} />
          <button className="primary" disabled={busy}>
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
        <p className="muted small">
          Setting up a child’s device? Open <a href="/device">/device</a> on it.
        </p>
      </main>
    </>
  );
}

function Dashboard({ parent, onSignedOut }: { parent: Parent; onSignedOut: () => void }) {
  const [children, setChildren] = useState<Child[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadChildren = useCallback(async () => {
    const res = await api<{ children: Child[] }>('/children');
    setChildren(res.children);
    setSelected((current) =>
      current !== null && res.children.some((c) => c.id === current) ? current : (res.children[0]?.id ?? null),
    );
    setLoaded(true);
  }, []);

  useEffect(() => {
    void loadChildren();
  }, [loadChildren]);

  async function signOut() {
    await api('/auth/logout', { method: 'POST' });
    onSignedOut();
  }

  return (
    <>
      <Brand>
        <span className="muted small">{parent.name}</span>
        <button onClick={signOut}>Sign out</button>
      </Brand>
      <div className="layout">
        <aside className="sidebar">
          <h2>Children</h2>
          <ul className="child-list">
            {children.map((child) => (
              <li key={child.id}>
                <button className={child.id === selected ? 'selected' : ''} onClick={() => setSelected(child.id)}>
                  {child.name}
                  {child.pendingRequests ? <span className="badge">{child.pendingRequests}</span> : null}
                </button>
              </li>
            ))}
          </ul>
          <AddChildForm
            onAdded={async (id) => {
              await loadChildren();
              setSelected(id);
            }}
          />
        </aside>
        <main className="content">
          {selected !== null ? (
            <ChildPanel key={selected} childId={selected} onChanged={loadChildren} />
          ) : (
            loaded && (
              <div className="empty">
                <h1>Add your first child</h1>
                <p className="muted">
                  Create a profile, set a daily limit, then pair their device. The device shows them a clear notice
                  of what is shared before it reports anything.
                </p>
              </div>
            )
          )}
        </main>
      </div>
    </>
  );
}

function AddChildForm({ onAdded }: { onAdded: (id: number) => void | Promise<void> }) {
  const [name, setName] = useState('');
  const [limit, setLimit] = useState(120);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const res = await api<{ child: Child }>('/children', { body: { name, dailyLimitMinutes: limit } });
      setName('');
      await onAdded(res.child.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={submit} className="stack add-child">
      <label>
        Name
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Daily limit (minutes)
        <input type="number" min={0} max={1440} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
      </label>
      <ErrorText error={error} />
      <button className="primary">Add child</button>
    </form>
  );
}

function ChildPanel({ childId, onChanged }: { childId: number; onChanged: () => Promise<void> }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSummary(await api<Summary>(`/children/${childId}/summary?day=${today()}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [childId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!summary) return <ErrorText error={error} />;
  const { child, policy } = summary;
  const pending = summary.timeRequests.filter((r) => r.status === 'pending');
  const maxWeek = Math.max(1, policy.dailyLimitMinutes, ...summary.week.map((d) => d.minutes));

  return (
    <div className="panel">
      <div className="panel-head">
        <h1>{child.name}</h1>
        <button onClick={load}>Refresh</button>
      </div>
      <ErrorText error={error} />

      <div className="grid">
        <Card title="Today">
          <TimeMeter policy={policy} />
          <UsageList usage={summary.usage} />
        </Card>

        <Card title="Requests for more time">
          {pending.length === 0 && <p className="muted">No requests waiting.</p>}
          <ul className="list">
            {summary.timeRequests.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>{formatMinutes(r.minutes)}</strong> on {r.day}: “{r.reason}”
                  <div className="muted small">{formatTime(r.createdAt)}</div>
                </div>
                {r.status === 'pending' ? (
                  <div className="row">
                    <button
                      className="primary"
                      onClick={() => act(() => api(`/time-requests/${r.id}/decision`, { body: { approve: true } }))}
                    >
                      Approve
                    </button>
                    <button onClick={() => act(() => api(`/time-requests/${r.id}/decision`, { body: { approve: false } }))}>
                      Deny
                    </button>
                  </div>
                ) : (
                  <span className={`tag tag-${r.status}`}>{r.status}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Last 7 days">
          <div className="week" role="img" aria-label="Minutes of screen time per day for the last 7 days">
            {summary.week.map((d) => (
              <div key={d.day} className="week-day" title={`${d.day}: ${formatMinutes(d.minutes)}`}>
                <span
                  className={d.minutes > policy.dailyLimitMinutes ? 'over' : ''}
                  style={{ height: `${(d.minutes / maxWeek) * 100}%` }}
                />
                <small>{new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</small>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Check-ins">
          {summary.checkIns.length === 0 ? (
            <p className="muted">No check-ins yet.</p>
          ) : (
            <ul className="list">
              {summary.checkIns.map((c) => (
                <li key={c.id}>
                  <div>
                    “{c.message}”<div className="muted small">{formatTime(c.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <RulesCard child={child} onSave={(patch) => act(() => api(`/children/${child.id}`, { method: 'PATCH', body: patch }))} />

        <BlockedSitesCard summary={summary} act={act} />

        <DevicesCard summary={summary} act={act} reload={load} />

        <Card title="Profile">
          <p className="muted small">Deleting a profile removes its devices and all of its reported data.</p>
          <button
            className="danger"
            onClick={() => {
              if (window.confirm(`Delete ${child.name}'s profile and all of its data?`)) {
                void act(() => api(`/children/${child.id}`, { method: 'DELETE' }));
              }
            }}
          >
            Delete profile
          </button>
        </Card>
      </div>
    </div>
  );
}

function RulesCard({ child, onSave }: { child: Child; onSave: (patch: Partial<Child>) => Promise<void> }) {
  const [limit, setLimit] = useState(child.dailyLimitMinutes);
  const [start, setStart] = useState(child.bedtimeStart ?? '');
  const [end, setEnd] = useState(child.bedtimeEnd ?? '');
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave({ dailyLimitMinutes: limit, bedtimeStart: start || null, bedtimeEnd: end || null });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Card title="Rules">
      <form onSubmit={submit} className="stack">
        <label>
          Daily screen time (minutes)
          <input type="number" min={0} max={1440} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
        </label>
        <div className="row">
          <label>
            Bedtime starts
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            Bedtime ends
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <button className="primary">{saved ? 'Saved' : 'Save rules'}</button>
      </form>
    </Card>
  );
}

function BlockedSitesCard({ summary, act }: { summary: Summary; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [domain, setDomain] = useState('');
  return (
    <Card title="Blocked websites">
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            await api(`/children/${summary.child.id}/blocked-sites`, { body: { domain } });
            setDomain('');
          });
        }}
      >
        <input aria-label="Domain to block" placeholder="example.com" required value={domain} onChange={(e) => setDomain(e.target.value)} />
        <button className="primary">Block</button>
      </form>
      <ul className="chips">
        {summary.blockedSites.map((site) => (
          <li key={site.id}>
            {site.domain}
            <button
              aria-label={`Unblock ${site.domain}`}
              onClick={() => act(() => api(`/blocked-sites/${site.id}`, { method: 'DELETE' }))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DevicesCard({
  summary,
  act,
  reload,
}: {
  summary: Summary;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createDevice(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const res = await api<{ pairingCode: string; pairingExpiresAt: string }>(`/children/${summary.child.id}/devices`, {
        body: { name },
      });
      setPairing({ code: res.pairingCode, expiresAt: res.pairingExpiresAt });
      setName('');
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card title="Devices">
      {summary.devices.length === 0 && <p className="muted">No devices yet.</p>}
      <ul className="list">
        {summary.devices.map((d) => (
          <li key={d.id}>
            <div>
              <strong>{d.name}</strong> <span className={`tag tag-${d.status.replace(/\s/g, '-')}`}>{d.status}</span>
              {d.lastSeenAt && <div className="muted small">Last seen {formatTime(d.lastSeenAt)}</div>}
            </div>
            <button
              onClick={() => {
                if (window.confirm(`Remove ${d.name}? It will stop reporting and its data will be deleted.`)) {
                  void act(() => api(`/devices/${d.id}`, { method: 'DELETE' }));
                }
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {pairing && summary.devices.some((d) => d.status === 'awaiting pairing') && (
        <div className="pairing">
          <p className="small">
            On {summary.child.name}’s device, open <strong>{window.location.origin}/device</strong> and enter:
          </p>
          <p className="code">{pairing.code}</p>
          <p className="muted small">Valid until {formatTime(pairing.expiresAt)}. It works once.</p>
        </div>
      )}
      <form onSubmit={createDevice} className="row">
        <input aria-label="Device name" placeholder="e.g. Alex's tablet" required value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary">Pair a device</button>
      </form>
      <ErrorText error={error} />
    </Card>
  );
}
