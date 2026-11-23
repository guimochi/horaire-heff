import { describe, expect, it } from 'vitest';
import { searchPromos } from '../../src/app/store';

// List from design/Promo.dc.html.
const all = ['3 EDP', '3 MATH', '3 SC', 'BA1 - S1 - A', 'BA1 - S1 - B', 'BA1 - S3 - EPS - A', 'BA1 - S3 - EPS - B',
  'BA1 - S3 - MATH', 'BA2 - S1', 'BA2 - S3 - EPS', 'BA2 - S3 - LG', 'BA2 - S3 - MATH', 'BA3 - S3 - EPS', 'BA3 - S3 - MATH'];

describe('searchPromos', () => {
  it('all_words_must_match', () => {
    expect(searchPromos(all, 'ba3 eps')).toEqual(['BA3 - S3 - EPS']);
  });
  it('eps_matches_the_four_eps_promos', () => {
    expect(searchPromos(all, 'EPS')).toEqual(['BA1 - S3 - EPS - A', 'BA1 - S3 - EPS - B', 'BA2 - S3 - EPS', 'BA3 - S3 - EPS']);
  });
  it('blank_query_returns_everything', () => {
    expect(searchPromos(all, '  ')).toEqual(all);
  });
  it('accents_are_ignored', () => {
    expect(searchPromos(all, 'éps')).toEqual(searchPromos(all, 'eps'));
  });
  it('punctuation_is_ignored', () => {
    expect(searchPromos(all, 'ba3-s3')).toEqual(['BA3 - S3 - EPS', 'BA3 - S3 - MATH']);
  });
});
