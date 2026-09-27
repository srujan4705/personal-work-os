import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DayStrip } from '../src/components/DayStrip';
import { Bars } from '../src/components/Bars';
import { Empty, LabelChip } from '../src/components/ui';
import { parseDuration, toEntryPayload } from '../src/components/EntryForm';
import { addDays, todayIn } from '../src/lib/date';

describe('web components', () => {
  it('renders the four trust labels distinctly', () => {
    render(<><LabelChip label="CONFIRMED" /><LabelChip label="SUGGESTED" /><LabelChip label="OBSERVED" /><LabelChip label="EXTERNAL" /></>);
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Suggested').className).toContain('border-dashed');
    expect(screen.getByText('Observed').className).toContain('border-dotted');
    expect(screen.getByText('From Zoho')).toBeInTheDocument();
  });
  it('draws the day ledger with a legend', () => {
    render(<DayStrip items={[{ id: '1', label: 'CONFIRMED', start: '10:00', end: '11:00', title: 'ER-1' }, { id: '2', label: 'OBSERVED', start: '12:00', end: null, title: 'commit' }]} />);
    expect(screen.getByLabelText('Day overview')).toBeInTheDocument();
    expect(screen.getByTitle('10:00–11:00 ER-1')).toBeInTheDocument();
    expect(screen.getByTitle('12:00 commit')).toBeInTheDocument();
  });
  it('shows an empty state for bars and empty lists', () => {
    render(<><Bars rows={[]} /><Empty title="No time logged">Add one</Empty></>);
    expect(screen.getByText('No logged time in this period.')).toBeInTheDocument();
    expect(screen.getByText('No time logged')).toBeInTheDocument();
  });
});

describe('entry parsing', () => {
  it('understands common duration formats', () => {
    expect(parseDuration('30m')).toBe(30);
    expect(parseDuration('1.5h')).toBe(90);
    expect(parseDuration('1h 15m')).toBe(75);
    expect(parseDuration('2')).toBe(120);
    expect(parseDuration('')).toBeUndefined();
  });
  it('builds the API payload', () => {
    expect(toEntryPayload({ ticket: ' ER-1 ', activityType: 'TESTING', duration: '45m', startTime: '', endTime: '', description: '' })).toEqual({ ticket: 'ER-1', activityType: 'TESTING', durationMinutes: 45, startTime: null, endTime: null, description: null });
  });
  it('computes dates in the user timezone', () => {
    expect(todayIn('Asia/Kolkata', new Date('2026-09-22T20:00:00Z'))).toBe('2026-09-23');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});
