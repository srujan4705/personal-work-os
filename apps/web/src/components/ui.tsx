import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { titleCase } from '@pwos/shared';
import type { Label } from '../lib/types';

type Variant = 'primary' | 'quiet' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'gradient-accent text-white shadow-[0_8px_20px_-8px_var(--color-accent-1)] hover:brightness-110 hover:shadow-[0_10px_26px_-8px_var(--color-accent-1)] active:brightness-95',
  quiet: 'glass text-ink hover:border-accent-2/50 hover:text-ink',
  danger: 'border border-danger/35 text-danger bg-danger/[0.06] hover:bg-danger/[0.12]',
  ghost: 'text-graphite hover:text-ink hover:bg-ink/[0.05]',
};

/** Shared button styling, also used for <a> elements that act as buttons (exports, OAuth connect). */
export const buttonClass = (variant: Variant = 'quiet', extra = '') =>
  `inline-flex items-center justify-center gap-1.5 rounded-control px-3.5 py-1.5 text-sm font-bold transition-all duration-200 ease-out disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100 disabled:hover:shadow-none ${variants[variant]} ${extra}`;

export function Button({ variant = 'quiet', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...p} className={buttonClass(variant, className)} />;
}

/** Segmented control (tab list). Keeps role="tablist"/"tab" semantics; active tab carries the gradient. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: readonly T[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="glass inline-flex gap-0.5 rounded-control p-1" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          role="tab"
          aria-selected={value === o}
          onClick={() => onChange(o)}
          className={`rounded-[0.45rem] px-3 py-1 text-sm capitalize transition-all duration-200 ${
            value === o ? 'gradient-accent font-bold text-white shadow-[0_4px_12px_-4px_var(--color-accent-1)]' : 'text-graphite hover:bg-ink/[0.05] hover:text-ink'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/** A KPI tile. `accent` gives the number the signature gradient — use it for the one headline figure in a row. */
export function Stat({ value, label, accent = false }: { value: ReactNode; label: ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-control border border-ink/[0.07] bg-ink/[0.03] px-4 py-3">
      <p className={`font-display text-2xl font-semibold num leading-tight ${accent ? 'gradient-text' : 'text-ink'}`}>{value}</p>
      <p className="mt-0.5 text-xs text-graphite">{label}</p>
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{children}</div>;
}

const fieldBase = 'rounded-control glass px-3 py-1.5 text-sm placeholder:text-graphite/70 transition-shadow duration-200 focus:outline-none focus:border-accent-2/60 focus:ring-2 focus:ring-accent-2/25';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...p }, ref) {
  return <input ref={ref} {...p} className={`${fieldBase} ${className}`} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = '', ...p }, ref) {
  return <select ref={ref} {...p} className={`${fieldBase} ${className}`} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = '', ...p }, ref) {
  return <textarea ref={ref} {...p} className={`w-full ${fieldBase} leading-relaxed ${className}`} />;
});

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-bold text-ink/90">{label}</span>
      {children}
      {hint && <span className="text-xs text-graphite">{hint}</span>}
    </label>
  );
}

/** The one recurring surface: a glass card with soft resting elevation and a gentle lift on hover. */
export function Section({ title, action, children, className = '' }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel glass p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-display text-[0.95rem] font-semibold tracking-tight text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const labelStyles: Record<Label, string> = {
  CONFIRMED: 'bg-confirmed text-white',
  SUGGESTED: 'border border-dashed border-suggested text-suggested',
  OBSERVED: 'border border-dotted border-observed text-observed',
  EXTERNAL: 'border border-external/50 text-external',
};
const labelText: Record<Label, string> = { CONFIRMED: 'Confirmed', SUGGESTED: 'Suggested', OBSERVED: 'Observed', EXTERNAL: 'Synced' };

/** The four trust levels, drawn the same way everywhere. */
export function LabelChip({ label }: { label: Label }) {
  return <span className={`inline-block rounded-full px-2 text-[11px] font-bold leading-5 ${labelStyles[label]}`}>{labelText[label]}</span>;
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'good' | 'bad' }) {
  const t = {
    neutral: 'bg-ink/[0.06] text-graphite',
    warn: 'bg-suggested/15 text-suggested',
    good: 'bg-confirmed/15 text-confirmed',
    bad: 'bg-danger/15 text-danger',
  }[tone];
  return <span className={`inline-block rounded-full px-2 text-xs font-bold leading-5 ${t}`}>{children}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-rule px-4 py-8 text-center">
      <p className="font-display font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-graphite">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="rounded-control border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error instanceof Error ? error.message : String(error)}</p>;
}

/** A skeleton bar, since "Loading…" text doesn't belong on an instrument panel. */
export function Loading() {
  return (
    <div className="flex flex-col gap-2 py-2" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="skeleton h-4 w-2/3" />
      <div className="skeleton h-4 w-full" />
      <div className="skeleton h-4 w-5/6" />
    </div>
  );
}

export const activityLabel = (a: string) => titleCase(a);

export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <h1 className="font-display text-[1.7rem] font-semibold tracking-tight text-ink">{title}</h1>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}
