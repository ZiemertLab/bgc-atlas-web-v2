import { describe, expect, it } from 'vitest';
import { REFRESH_TIERS, untrackedMatviews } from './refresh-tiers';

describe('REFRESH_TIERS', () => {
    it('lists each matview once', () => {
        const all = REFRESH_TIERS.flat();
        expect(new Set(all).size).toBe(all.length);
    });
});

describe('untrackedMatviews', () => {
    it('returns live matviews missing from the tiers', () => {
        expect(untrackedMatviews(['gcf_summary_mv', 'some_new_mv'])).toEqual(['some_new_mv']);
    });

    it('ignores rollback copies kept by a migration', () => {
        expect(untrackedMatviews(['gcf_distributions_mv_pre0112'])).toEqual([]);
    });

    it('does not report tracked views that are absent from the database', () => {
        expect(untrackedMatviews([])).toEqual([]);
    });
});
