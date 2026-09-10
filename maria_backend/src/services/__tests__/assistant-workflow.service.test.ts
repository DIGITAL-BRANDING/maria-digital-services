import { describe, expect, it } from 'vitest';
import { assistantWorkflows, parseAssistantIntent, phraseMatches } from '../assistant-workflow.service.js';

/**
 * Tests parseAssistantIntent - specifically the word-boundary matching fix
 * for the bug where a plain `.includes()` let short intent triggers
 * misfire on ordinary words that merely happen to contain them as a
 * substring ('nin' inside "training", 'data' inside "database", and the
 * worst case: ipe_clearance's old 'ipe ' trigger - a hand-rolled trailing-
 * space "boundary" that still matched inside "swipe " / "recipe " while
 * ALSO failing to match "ipe" typed as the last word of a message with no
 * trailing space at all).
 */

describe('phraseMatches', () => {
  it('does not match a short phrase buried inside an unrelated longer word', () => {
    expect(phraseMatches('i need training on this app', 'nin')).toBe(false);
    expect(phraseMatches('what is in the database', 'data')).toBe(false);
    expect(phraseMatches('please swipe to confirm', 'ipe')).toBe(false);
    expect(phraseMatches('what is your favourite recipe', 'ipe')).toBe(false);
  });

  it('matches a phrase that stands alone as a whole word', () => {
    expect(phraseMatches('check my nin please', 'nin')).toBe(true);
    expect(phraseMatches('i want to buy data', 'data')).toBe(true);
    expect(phraseMatches('ipe clearance abeg', 'ipe')).toBe(true);
  });

  it('matches when the phrase is the entire message with nothing else around it', () => {
    expect(phraseMatches('ipe', 'ipe')).toBe(true);
    expect(phraseMatches('nin', 'nin')).toBe(true);
  });

  it('matches multi-word phrases as a unit, respecting boundaries on both ends', () => {
    expect(phraseMatches('i want to check my bvn slip now', 'bvn slip')).toBe(true);
    expect(phraseMatches('my bvn slippers are gone', 'bvn slip')).toBe(false);
  });

  it('is punctuation-tolerant at the boundary (a comma/period still counts as a boundary)', () => {
    expect(phraseMatches('nin, please', 'nin')).toBe(true);
    expect(phraseMatches('i want data.', 'data')).toBe(true);
  });
});

describe('parseAssistantIntent - the historical false positives this fix addresses', () => {
  it('does not start a NIN lookup because the message merely says "training"', () => {
    expect(parseAssistantIntent('I need training on how to use this app').workflow).toBeUndefined();
  });

  it('does not start a data purchase because the message only mentions a "database"', () => {
    expect(parseAssistantIntent('where is the database stored').workflow).toBeUndefined();
  });

  it('does not start IPE clearance because the message says "swipe"', () => {
    expect(parseAssistantIntent('let me swipe to confirm this payment').workflow).toBeUndefined();
  });

  it('does not start IPE clearance because the message mentions a "recipe"', () => {
    expect(parseAssistantIntent('do you have a recipe for jollof rice').workflow).toBeUndefined();
  });

  it('DOES start IPE clearance for "ipe" typed alone with no trailing space (the old bug missed this entirely)', () => {
    expect(parseAssistantIntent('ipe').workflow).toBe('ipe_clearance');
  });

  it('DOES start IPE clearance for a natural request', () => {
    expect(parseAssistantIntent('I need ipe clearance').workflow).toBe('ipe_clearance');
  });
});

describe('parseAssistantIntent - real requests still work', () => {
  it('recognizes a plain NIN slip request', () => {
    expect(parseAssistantIntent('check my nin').workflow).toBe('nin_by_nin');
  });

  it('recognizes a plain BVN slip request', () => {
    expect(parseAssistantIntent('fetch bvn').workflow).toBe('bvn_slip');
  });

  it('recognizes data purchase requests in English and Hausa', () => {
    expect(parseAssistantIntent('I want to buy data').workflow).toBe('data');
    expect(parseAssistantIntent('sayi min data').workflow).toBe('data');
  });

  it('still prefers the more specific NIN workflow over the generic catch-all', () => {
    expect(parseAssistantIntent('nin by phone please').workflow).toBe('nin_by_phone');
    expect(parseAssistantIntent('find my bvn').workflow).toBe('bvn_retrieval');
  });

  it('extracts network, phone, and amount together without the phone digits leaking into amount', () => {
    const result = parseAssistantIntent('recharge 500 airtime for 08012345678 on mtn');
    expect(result.workflow).toBe('airtime');
    expect(result.fields.network).toBe('MTN');
    expect(result.fields.phone).toBe('08012345678');
    expect(result.fields.amount).toBe(500);
  });

  it('recognizes a data size (1GB) as a data request even without the word "data"', () => {
    expect(parseAssistantIntent('sayi min 1GB for 08012345678').workflow).toBe('data');
  });

  it('does not mistake "incorporated" for the CORPORATE data type', () => {
    const result = parseAssistantIntent('MAJOR DATA-LINK is a registered incorporated business');
    expect(result.fields.data_type).toBeUndefined();
  });

  it('recognizes an explicit CORPORATE data type request', () => {
    const result = parseAssistantIntent('buy corporate data for 08012345678');
    expect(result.fields.data_type).toBe('CORPORATE');
  });
});

describe('assistantWorkflows catalog self-consistency (mechanical regression guard)', () => {
  // Mirrors the same kind of audit built for the informational assistant's
  // classifier: every single intent phrase declared in assistantWorkflows,
  // sent alone as if it were the entire message, must resolve back to the
  // workflow that owns it. This automatically catches ambiguity introduced
  // by any future intent phrase addition/edit (a duplicate phrase across
  // two workflows, or a short phrase that's a substring of a longer one
  // belonging to a DIFFERENT, earlier-ordered workflow) without a human
  // having to re-audit the whole catalog by hand every time.
  for (const workflow of assistantWorkflows) {
    for (const intent of workflow.intents) {
      const trimmed = intent.trim();
      if (!trimmed) continue; // guards against a stray '' entry ever being added
      it(`"${trimmed}" resolves to workflow "${workflow.id}"`, () => {
        expect(parseAssistantIntent(trimmed).workflow).toBe(workflow.id);
      });
    }
  }
});

describe('assistantWorkflows catalog - no exact duplicate intent phrases across workflows', () => {
  it('every intent phrase is declared by exactly one workflow', () => {
    const owners = new Map<string, string[]>();
    for (const workflow of assistantWorkflows) {
      for (const intent of workflow.intents) {
        const key = intent.trim().toLowerCase();
        owners.set(key, [...(owners.get(key) ?? []), workflow.id]);
      }
    }
    const duplicates = [...owners.entries()].filter(([, ids]) => ids.length > 1);
    expect(duplicates).toEqual([]);
  });
});
