import { describe, it, expect } from 'vitest';
import { formatTime, daysAgoLabel } from '../dateFormat';

describe('formatTime', () => {
  it('returns a time string for a timestamp from today', () => {
    const now = new Date();
    const result = formatTime(now.toISOString());
    // لازم يرجع وقت (فيه ':') مش تاريخ كامل، لأنه النهارده
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it('returns "Yesterday" for a timestamp from exactly one day ago', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatTime(yesterday.toISOString())).toBe('Yesterday');
  });

  it('returns a date string (day + month) for older timestamps', () => {
    const old = new Date();
    old.setDate(old.getDate() - 10);
    const result = formatTime(old.toISOString());
    expect(result).not.toBe('Yesterday');
    expect(result).not.toMatch(/^\d{1,2}:\d{2}/);
  });
});

describe('daysAgoLabel', () => {
  it('returns "Today" for the current date', () => {
    expect(daysAgoLabel(new Date().toISOString())).toBe('Today');
  });

  it('returns "Yesterday" for exactly one day ago', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(daysAgoLabel(yesterday.toISOString())).toBe('Yesterday');
  });

  it('returns "N days ago" for older dates', () => {
    const old = new Date();
    old.setDate(old.getDate() - 5);
    expect(daysAgoLabel(old.toISOString())).toBe('5 days ago');
  });

  it('returns an empty string for a missing value', () => {
    expect(daysAgoLabel(null)).toBe('');
    expect(daysAgoLabel(undefined)).toBe('');
  });
});
