import { describe, it, expect } from 'vitest';
import { mapApiConversation, dayDividerLabel, hexToRgba, parseLabelsJson } from '../mappers';

describe('mapApiConversation', () => {
  it('maps a closed API status to the resolved UI status', () => {
    const row = { id: 1, status: 'closed', contact_number: '+201001234567', created_at: new Date().toISOString() };
    const result = mapApiConversation(row);
    expect(result.status).toBe('resolved');
    expect(result.rawStatus).toBe('closed');
  });

  it('maps any non-closed API status to the open UI status', () => {
    const row = { id: 2, status: 'assigned', contact_number: '+201001234567', created_at: new Date().toISOString() };
    expect(mapApiConversation(row).status).toBe('open');
  });

  it('falls back to the phone number when no contact name exists', () => {
    const row = { id: 3, status: 'open', contact_number: '+201009999999', created_at: new Date().toISOString() };
    expect(mapApiConversation(row).name).toBe('+201009999999');
  });
});

describe('parseLabelsJson', () => {
  it('parses a valid JSON array string', () => {
    expect(parseLabelsJson('[{"id":1,"name":"Urgent"}]')).toEqual([{ id: 1, name: 'Urgent' }]);
  });

  it('returns an empty array for null/undefined/invalid JSON', () => {
    expect(parseLabelsJson(null)).toEqual([]);
    expect(parseLabelsJson(undefined)).toEqual([]);
    expect(parseLabelsJson('not json')).toEqual([]);
  });
});

describe('hexToRgba', () => {
  it('converts a 6-digit hex color to an rgba string', () => {
    expect(hexToRgba('#6C5CE7', 0.5)).toBe('rgba(108,92,231,0.5)');
  });

  it('falls back to the default primary color when given no input', () => {
    expect(hexToRgba(undefined, 1)).toBe('rgba(108,92,231,1)');
  });
});

describe('dayDividerLabel', () => {
  it('returns "Today" for the current date', () => {
    expect(dayDividerLabel(new Date().toISOString())).toBe('Today');
  });
});
