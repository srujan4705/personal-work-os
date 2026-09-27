import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { titleCase } from '@pwos/shared';
import type { Label } from '../lib/types';

type Variant = 'primary' | 'quiet' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:opacity-90',
  quiet: 'border border-rule bg-sheet hover:border-graphite',
  danger: 'border border-danger/40 text-danger hover:bg-danger/10',
  ghost: 'text-graphite hover:text-ink hover:bg-rule/50',
};

export function Button({ variant = 'quiet', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...p} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${className}`} />;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...p }, ref) {
  return <input ref={ref} {...p} className={`rounded-md border border-rule px-2.5 py-1.5 text-sm placeholder:text-graphite/70 focus:border-graphite ${className}`} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = '', ...p }, ref) {
  return <select ref={ref} {...p} className={`rounded-md border border-rule px-2 py-1.5 text-sm ${className}`} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = '', ...p }, ref) {
  return <textarea ref={ref} {...p} className={`w-full rounded-md border border-rule px-2.5 py-2 text-sm leading-relaxed ${className}`} />;
});

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-bold">{label}</span>
      {children}
      {hint && <span className="text-xs text-graphite">{hint}</span>}
    </label>
  );
}

export function Section({ title, action, children, className = '' }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-rule bg-sheet p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const labelStyles: Record<Label, string> = {
  CONFIRMED: 'bg-confirmed text-white border-confirmed',
  SUGGESTED: 'border-dashed border-suggested text-suggested',
  OBSERVED: 'border-dotted border-observed text-observed',
  EXTERNAL: 'border-external text-external',
};
const labelText: Record<Label, string> = { CONFIRMED: 'Confirmed', SUGGESTED: 'Suggested', OBSERVED: 'Observed', EXTERNAL: 'From Zoho' };

/** The four trust levels, drawn the same way everywhere. */
export function LabelChip({ label }: { label: Label }) {
  return <span className={`inline-block rounded border-[1.5px] px-1.5 text-[11px] font-bold leading-4 ${labelStyles[label]}`}>{labelText[label]}</span>;
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'good' | 'bad' }) {
  const t = { neutral: 'bg-rule/60 text-graphite', warn: 'bg-suggested/15 text-suggested', good: 'bg-confirmed/15 text-confirmed', bad: 'bg-danger/15 text-danger' }[tone];
  return <span className={`inline-block rounded px-1.5 text-xs font-bold leading-5 ${t}`}>{children}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-rule px-4 py-6 text-center">
      <p className="font-bold">{title}</p>
      {children && <div className="mt-1 text-sm text-graphite">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error instanceof Error ? error.message : String(error)}</p>;
}

export function Loading() {
  return <p className="py-6 text-sm text-graphite" aria-live="polite">Loading…</p>;
}

export const activityLabel = (a: string) => titleCase(a);

export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}
