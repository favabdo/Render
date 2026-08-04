import { describe, it, expect } from 'vitest';
import { initialsFromName, avatarColorFor } from '../avatar';

describe('initialsFromName', () => {
  it('returns first+last initials for a full name', () => {
    expect(initialsFromName('Ahmed Elsawy')).toBe('AE');
  });

  it('returns first two letters for a single-word name', () => {
    expect(initialsFromName('Ahmed')).toBe('AH');
  });

  it('handles three or more words by using first and last only', () => {
    expect(initialsFromName('Ahmed Mohamed Elsawy')).toBe('AE');
  });

  it('returns "?" for empty or missing input', () => {
    expect(initialsFromName('')).toBe('?');
    expect(initialsFromName(null)).toBe('?');
    expect(initialsFromName(undefined)).toBe('?');
  });

  it('trims and collapses extra whitespace', () => {
    expect(initialsFromName('  Ahmed   Elsawy  ')).toBe('AE');
  });
});

describe('avatarColorFor', () => {
  it('always returns the same single brand color, regardless of seed', () => {
    const a = avatarColorFor('agent-42');
    const b = avatarColorFor('some-other-seed');
    expect(a).toBe(b);
    expect(a).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('handles an empty seed without throwing', () => {
    expect(() => avatarColorFor('')).not.toThrow();
    expect(() => avatarColorFor(undefined)).not.toThrow();
  });
});
