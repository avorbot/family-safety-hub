import type { ReactNode } from 'react';
import { formatMinutes, type Notice, type Policy, type UsageRow } from './api';

export function Brand({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16 3 5 7v8c0 7 4.7 12 11 14 6.3-2 11-7 11-14V7z" />
        </svg>
        Family Safety Hub
      </div>
      <div className="topbar-actions">{children}</div>
    </header>
  );
}

export function Card({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

export function TimeMeter({ policy }: { policy: Policy }) {
  const allowed = policy.dailyLimitMinutes + policy.extraMinutes;
  const pct = allowed === 0 ? 100 : Math.min(100, Math.round((policy.usedMinutes / allowed) * 100));
  return (
    <div className="meter">
      <div className="meter-figures">
        <span className="big">{formatMinutes(policy.remainingMinutes)}</span>
        <span className="muted">left today</span>
      </div>
      <div
        className={`bar${policy.limitReached ? ' bar-full' : pct >= 80 ? ' bar-warn' : ''}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={allowed}
        aria-valuenow={Math.min(policy.usedMinutes, allowed)}
        aria-label="Screen time used today"
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="muted small">
        {formatMinutes(policy.usedMinutes)} used of {formatMinutes(policy.dailyLimitMinutes)}
        {policy.extraMinutes > 0 && ` + ${formatMinutes(policy.extraMinutes)} extra`}
        {policy.bedtime && ` · Bedtime ${policy.bedtime.start}–${policy.bedtime.end}`}
      </p>
    </div>
  );
}

export function UsageList({ usage }: { usage: UsageRow[] }) {
  if (usage.length === 0) return <p className="muted">No activity reported yet today.</p>;
  const max = Math.max(...usage.map((row) => row.minutes));
  return (
    <ul className="usage">
      {usage.map((row) => (
        <li key={`${row.label}-${row.category}`}>
          <span className="usage-label">
            {row.label} <span className="tag">{row.category}</span>
          </span>
          <span className="usage-bar">
            <span style={{ width: `${(row.minutes / max) * 100}%` }} />
          </span>
          <span className="usage-min">{formatMinutes(row.minutes)}</span>
        </li>
      ))}
    </ul>
  );
}

export function NoticePanel({ notice }: { notice: Notice }) {
  return (
    <div className="notice">
      <p>{notice.summary}</p>
      <div className="notice-cols">
        <div>
          <h3>Shared with your parent</h3>
          <ul className="ticks">
            {notice.collected.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Never collected</h3>
          <ul className="crosses">
            {notice.notCollected.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="small">
        <strong>Who can see it:</strong> {notice.whoCanSee}
      </p>
      <p className="small">
        <strong>What you can do:</strong> {notice.yourControls}
      </p>
    </div>
  );
}
