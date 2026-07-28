import { describe, it, expect } from 'vitest';
import { initialsFromName, avatarColorFor, AVATAR_COLORS } from '../avatar';

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
  it('is deterministic for the same seed', () => {
    const a = avatarColorFor('agent-42');
    const b = avatarColorFor('agent-42');
    expect(a).toBe(b);
  });

  it('always returns a color from the defined palette', () => {
    const color = avatarColorFor('some-random-seed-string');
    expect(AVATAR_COLORS).toContain(color);
  });

  it('handles an empty seed without throwing', () => {
    expect(() => avatarColorFor('')).not.toThrow();
    expect(() => avatarColorFor(undefined)).not.toThrow();
  });
});
