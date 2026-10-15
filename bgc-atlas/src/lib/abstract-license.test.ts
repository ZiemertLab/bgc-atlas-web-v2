import { describe, expect, it } from 'vitest';

import {
  ABSTRACT_STATES,
  abstractLicenseLabel,
  abstractState,
  canShowAbstract,
  isOpenAbstractLicense,
  isPublisherAbstract,
} from './abstract-license';

// Real URLs returned by Crossref for DOIs in the atlas.
const CC_BY = 'http://creativecommons.org/licenses/by/4.0/';
const CC_BY_NC_ND = 'https://creativecommons.org/licenses/by-nc-nd/4.0';
const CC_ZERO = 'https://creativecommons.org/publicdomain/zero/1.0/';
const OUP_REUSE = 'https://academic.oup.com/pages/standard-publication-reuse-rights';
const SPRINGER_TDM = 'http://www.springer.com/tdm';
const ELSEVIER_TDM = 'https://www.elsevier.com/tdm/userlicense/1.0/';

describe('isOpenAbstractLicense', () => {
  it.each([CC_BY, CC_BY_NC_ND, CC_ZERO, 'https://creativecommons.org/licenses/by-nc-sa/4.0'])(
    'treats %s as open',
    (url) => {
      // Verbatim reproduction is not a derivative, and the atlas is non-commercial.
      expect(isOpenAbstractLicense(url)).toBe(true);
    }
  );

  it.each([OUP_REUSE, SPRINGER_TDM, ELSEVIER_TDM])(
    'treats %s as closed',
    (url) => {
      // A text-and-data-mining grant permits mining, never redistribution.
      expect(isOpenAbstractLicense(url)).toBe(false);
    }
  );

  it('defaults to closed when Crossref published no licence', () => {
    expect(isOpenAbstractLicense(null)).toBe(false);
    expect(isOpenAbstractLicense(undefined)).toBe(false);
    expect(isOpenAbstractLicense('')).toBe(false);
  });

  it('is not fooled by a host that merely mentions creativecommons', () => {
    expect(isOpenAbstractLicense('https://example.com/about/creativecommons')).toBe(false);
  });
});

describe('canShowAbstract', () => {
  it('always shows archive-derived study descriptions', () => {
    expect(canShowAbstract('ena', null)).toBe(true);
    expect(canShowAbstract('mgnify', null)).toBe(true);
  });

  it('shows a publisher abstract only under a CC licence', () => {
    expect(canShowAbstract('crossref', CC_BY)).toBe(true);
    expect(canShowAbstract('crossref', OUP_REUSE)).toBe(false);
    expect(canShowAbstract('crossref', null)).toBe(false);
  });

  it('gates Europe PMC text on the licence too', () => {
    // Microflora Danica's abstract comes from a constant but is publisher text all the same.
    expect(canShowAbstract('europepmc', CC_BY_NC_ND)).toBe(true);
    expect(canShowAbstract('europepmc', OUP_REUSE)).toBe(false);
  });

  it('treats unknown provenance as not redistributable', () => {
    // Unknown provenance (e.g. not yet backfilled) links out instead of republishing.
    expect(canShowAbstract(null, CC_BY)).toBe(false);
    expect(canShowAbstract('something-new', CC_BY)).toBe(false);
  });
});

describe('isPublisherAbstract', () => {
  it('separates publisher text from archive descriptions', () => {
    expect(isPublisherAbstract('crossref')).toBe(true);
    expect(isPublisherAbstract('europepmc')).toBe(true);
    expect(isPublisherAbstract('ena')).toBe(false);
    expect(isPublisherAbstract('mgnify')).toBe(false);
    expect(isPublisherAbstract(null)).toBe(false);
  });
});

describe('abstractLicenseLabel', () => {
  it('names the common licences', () => {
    expect(abstractLicenseLabel(CC_BY)).toBe('CC BY 4.0');
    expect(abstractLicenseLabel(CC_BY_NC_ND)).toBe('CC BY-NC-ND 4.0');
    expect(abstractLicenseLabel(CC_ZERO)).toBe('CC0 1.0');
    expect(abstractLicenseLabel('https://creativecommons.org/publicdomain/mark/1.0/')).toBe(
      'Public Domain Mark 1.0'
    );
  });

  it('handles a CC URL with no version segment', () => {
    expect(abstractLicenseLabel('https://creativecommons.org/licenses/by-sa/')).toBe('CC BY-SA');
  });

  it('returns null rather than a misleading badge', () => {
    expect(abstractLicenseLabel(OUP_REUSE)).toBeNull();
    expect(abstractLicenseLabel(null)).toBeNull();
  });
});

describe('abstractState', () => {
  it('reports a withheld abstract as withheld, not as missing', () => {
    expect(abstractState({ hasAbstract: false, withheld: true })).toBe('withheld');
  });

  it('reports an abstract we hold as available', () => {
    expect(abstractState({ hasAbstract: true, withheld: false })).toBe('available');
  });

  it('reports "absent" only when nothing was held AND nothing was withheld', () => {
    expect(abstractState({ hasAbstract: false, withheld: false })).toBe('absent');
  });

  // Sibling rows can cite different papers; the state must agree with the text collapseSiblings() ships.
  it('prefers the text when one sibling has it and another was withheld', () => {
    expect(abstractState({ hasAbstract: true, withheld: true })).toBe('available');
  });

  it('only ever returns a value the catalog documents', () => {
    for (const hasAbstract of [true, false]) {
      for (const withheld of [true, false]) {
        expect(ABSTRACT_STATES).toContain(abstractState({ hasAbstract, withheld }));
      }
    }
  });
});
