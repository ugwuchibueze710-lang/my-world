// Procedural names: each kingdom has its own "culture" so names feel related within a realm.
const ONSETS = ['al', 'ar', 'bel', 'bor', 'cal', 'cor', 'dar', 'del', 'el', 'fen', 'gal', 'gor', 'hal', 'is', 'jor', 'kal', 'kor',
  'lan', 'lor', 'mar', 'mor', 'nar', 'nor', 'or', 'pel', 'quin', 'ran', 'ros', 'sal', 'sor', 'tal', 'tor', 'ul', 'val', 'vor', 'wen',
  'xan', 'yor', 'zan', 'ash', 'bran', 'dun', 'ed', 'kh', 'th', 'ser', 'aum', 'ny', 'ib', 'ka', 'ola', 'chi', 'ade', 'emi', 'zu'];
const MIDS = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'ei', 'ar', 'en', 'or', 'il', 'an', 'ol', 'eth', 'ad', 'im', 'un', 'ow', 'ey'];
const MALE_END = ['ric', 'dor', 'mund', 'win', 'bert', 'gar', 'ion', 'us', 'an', 'ard', 'mir', 'ek', 'os', 'oth', 'ius', 'ar', 'el', 'em', 'wu', 'ke'];
const FEMALE_END = ['a', 'ia', 'elle', 'wyn', 'ra', 'ina', 'eth', 'is', 'ana', 'ys', 'ora', 'ise', 'eya', 'ine', 'ka', 'mi', 'ola', 'ie', 'ah', 'ue'];
const REALM_END = ['ia', 'mark', 'heim', 'gard', 'dor', 'oria', 'land', 'reach', 'vale', 'mere', 'thal', 'wick', 'stan', 'garde', 'mor', 'ica', 'oth'];
const HOUSE_END = ['son', 'wood', 'crest', 'helm', 'fall', 'bane', 'stone', 'mont', 'ford', 'hart', 'shield', 'thorn', 'ridge', 'blade'];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

export class Culture {
  constructor(rand) {
    this.r = rand;
    // each culture prefers a subset of syllables
    this.on = Array.from({ length: 10 }, () => pick(ONSETS, rand));
    this.mid = Array.from({ length: 6 }, () => pick(MIDS, rand));
    this.me = Array.from({ length: 6 }, () => pick(MALE_END, rand));
    this.fe = Array.from({ length: 6 }, () => pick(FEMALE_END, rand));
  }
  derive(rand) { // a child culture drifts from its parent
    const c = new Culture(rand);
    c.on = this.on.map((s) => (rand() < 0.35 ? pick(ONSETS, rand) : s));
    c.me = this.me.map((s) => (rand() < 0.3 ? pick(MALE_END, rand) : s));
    c.fe = this.fe.map((s) => (rand() < 0.3 ? pick(FEMALE_END, rand) : s));
    return c;
  }
  person(sex) {
    const r = this.r;
    let s = pick(this.on, r);
    if (r() < 0.5) s += pick(this.mid, r);
    s += sex === 'F' ? pick(this.fe, r) : pick(this.me, r);
    return cap(s.replace(/(.)\1\1/g, '$1$1'));
  }
  realm() {
    const r = this.r;
    let s = pick(this.on, r) + (r() < 0.6 ? pick(this.mid, r) : '') + pick(REALM_END, r);
    return cap(s);
  }
  house() { return cap(pick(this.on, this.r) + pick(HOUSE_END, this.r)); }
}
