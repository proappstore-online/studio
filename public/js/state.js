// Shared constants, DOM refs, and mutable singletons.
//
// State is a single mutable object (S). Modules import { S } and mutate
// properties — ES module bindings are live so all importers see updates.

export const FAS_API = 'https://api.freeappstore.online';
export const PAS_API = 'https://api.proappstore.online';
export const DATA_API = 'https://data-wellness.proappstore.online';
export const APP_ID = 'wellness';
export const SESSION_KEY = 'fas:session';

// Mindbody-inspired category list. Stored as the slug; rendered as the label.
export const CATEGORIES = [
  ['yoga', 'Yoga'],
  ['pilates', 'Pilates'],
  ['hiit', 'HIIT'],
  ['cycling', 'Cycling / Spin'],
  ['strength', 'Strength training'],
  ['cardio', 'Cardio'],
  ['dance', 'Dance'],
  ['barre', 'Barre'],
  ['martial-arts', 'Martial arts'],
  ['boxing', 'Boxing / Kickboxing'],
  ['meditation', 'Meditation / Mindfulness'],
  ['stretching', 'Stretching / Mobility'],
  ['functional', 'Functional training'],
  ['prenatal', 'Prenatal'],
  ['kids', 'Kids / Family'],
  ['other', 'Other'],
];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// DOM refs grouped under a single object — accessed via dom.signinView
// (auto-mapped to id="signin-view") or dom['signin-view'] (literal).
// Resolved lazily on first access; cached after.
export const dom = new Proxy(
  {},
  {
    get(cache, key) {
      if (typeof key !== 'string') return undefined;
      if (cache[key] !== undefined) return cache[key];
      // Try the key as-is first (kebab-case lookup), then convert camelCase.
      let el = document.getElementById(key);
      if (!el && /[A-Z]/.test(key)) {
        const kebab = key.replace(/([A-Z])/g, '-$1').toLowerCase();
        el = document.getElementById(kebab);
      }
      cache[key] = el;
      return el;
    },
  },
);

// Mutable shared state. Reassign properties; importers see updates.
export const S = {
  session: null,
  currentStudio: null,
  classTypesCache: [],
  instructorsCache: [],
};
