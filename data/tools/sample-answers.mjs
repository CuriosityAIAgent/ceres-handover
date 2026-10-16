/*
 * The two sample respondents. R000001 answers each of the 63 questions and follow-ups of v3, in the shapes the
 * screens save; R000002 (SECOND, below) does not see any of the eleven conditional steps.
 *
 * Where a step has data.sample in script.js, that is the answer. Otherwise it is written below (WRITTEN), or, where
 * the screen builds its options from an earlier answer, derived from that answer as the screen would offer it:
 *   2.2a 2.5a 6.3a 7.2a   the first three cards of the parent's Critical pile, in the order they were placed
 *   2.6                   the tiles not put in Not for HNW on 2.2, plus the client's company (each tray from TRAYS_2_6)
 *   4.3a                  the roles stamped Only above an amount on 4.3 (each amount from AMOUNTS_4_3A)
 *   8.1a                  'cash-rate' if it is stamped Do it or Pilot it on 8.1, else the first card that is
 * build-sql.mjs checks every answer with validate() and stops if one is not complete.
 */

const WRITTEN = {
  '1.1': 'goals',
  '1.2': 'attention',
  '1.3': 'banker',
  '1.4': 'central-team',
  '2.1': {
    r1: 'I trust the name. It feels safe to keep a large part of our money here.',
    r2: 'My banker knows my family and calls before I have to ask.',
    r3: "I can invest in things my local bank doesn't offer, like private credit.",
  },
  '2.4': 'building-blocks',
  '2.4a': '4',
  '4.1a': 'jpm-other',
  '4.4': 'case-by-case',
  '5.2a': 'champion',
  '5.3': {
    'day-to-day': 'local',
    salary: 'local',
    'home-loan': 'local',
    'local-deposits': 'local',
    'usd-deposits': 'jpm',
    'local-shares': 'either',
    advice: 'jpm',
    lombard: 'jpm',
    alternatives: 'jpm',
    succession: 'either',
  },
  '5.3a': 'sg-hk',
  '5.4a': {
    existing: 30,
    'client-referrals': 20,
    introducers: 10,
    xlob: 15,
    marketing: 5,
    organic: 10,
    cold: 0,
    'money-in-motion': 5,
    'hired-books': 5,
  },
  '6.1': 'hybrid',
  '6.2a': ['jpm-office', 'business'],
  '6.2b': 'hour-2',
  '6.4': { md: 1, ed: 3, vp: 4, associate: 2 },
  '7.1': 60,
  '7.3': 'co-pilot',
  '7.4': {
    onboarding: 'ai-drafts',
    kyc: 'person-ai',
    suitability: 'person',
    proposal: 'ai-drafts',
    meetings: 'ai',
    servicing: 'ai',
    monitoring: 'ai-drafts',
    maintenance: 'ai',
  },
  '8.2': 'scorecard',
  '8.2a': 'adapted',
  '8.3': {
    'team-pay': 'pilot',
    'salary-only': 'never',
    'nnm-bonus': 'do',
    'hire-guarantee': 'pilot',
    'satisfaction-bonus': 'never',
  },
  '8.4a': '3',
  '8.4b': 'scorecard',
  '9.2': {
    bandwidth: 'gap',
    digital: 'fixable',
    talent: 'fixable',
    training: 'gap',
    referrals: 'ready',
    pay: 'gap',
    onboarding: 'fixable',
    pricing: 'fixable',
    products: 'ready',
    'service-model': 'gap',
  },
  '9.3': 'named-tier',
  '9.4': { n: 6000 },
  '9.4a': '5',
  '9.4b': { region: 'emea', market: 'United Arab Emirates' },
  '10.1': {
    excited: 'Reaching good clients we turn away today, and giving our younger bankers a book to grow.',
    nervous: 'That we build a cut-price version of the UHNW service and clients notice.',
  },
  '10.2': {
    fear: 'We launch with too many products and too few bankers, then cut the service when costs run over plan.',
  },
  '10.3': {
    name: 'UBS',
    why: 'One clear offer for this segment, priced simply, with a team that covers clients well by video.',
  },
  '10.4': {
    last: 'Ask how we hand a client over when they grow past $20mm.',
  },
  '10.5': {
    headline: 'J.P. Morgan opens its private bank to more families',
    quote: 'Clients with $5mm now get a named banker and the same research our largest families get.',
  },
}

/*
 * The second sample respondent (SID R000002). Their answers make every conditional step not show: two cards in
 * Critical on 2.2, one on 2.5, three on 6.3 (more than 3 are needed), none on 7.2; Engage and Entrust Not for HNW on
 * 2.3; no role stamped Only above an amount on 4.3; 5.4 is 0; no meetings on 6.2; one card stamped Do it on 8.1; 8.4 is
 * not the revenue share. 5.1's split is 10, so 5.2 has nothing to place; 4.2 is Never; 9.4b is a market typed without
 * a region; 10.3 uses the chip; 10.4 is left empty. null: no value (not shown, nothing to place, or skipped).
 */
const SECOND = {
  '1.1': 'advice',
  '1.2': 'speed',
  '1.3': 'name',
  '1.4': 'banker',
  '2.1': {
    r1: 'The name. It is the bank their company already uses.',
    r2: 'They can see everything in one app, wherever it is booked.',
    r3: 'A banker who answers the same day.',
  },
  '2.2': {
    banking: 'core', deposits: 'core', securities: 'critical', funds: 'core', 'core-offering': 'critical',
    structured: 'nice', derivatives: 'not-hnw', alternatives: 'nice', lombard: 'nice', mortgage: 'core',
    insurance: 'not-hnw', retirement: 'nice', crypto: 'not-hnw', esg: 'nice', thematic: 'nice',
  },
  '2.2a': null,
  '2.3': {
    execute: { belongs: 'core', covers: ['securities', 'funds'], who: 'online' },
    engage: { belongs: 'not-hnw', covers: [], who: null },
    entrust: { belongs: 'not-hnw', covers: [], who: null },
  },
  '2.4': null,
  '2.4a': null,
  '2.5': {
    'named-banker': 'critical', 'service-team': 'core', investor: 'nice', 'lending-specialist': 'nice',
    'trust-estate': 'nice', tax: 'not-hnw', 'wealth-plan': 'core', 'whole-wealth': 'nice', 'next-gen': 'not-hnw',
    'business-owner': 'nice', mobility: 'not-hnw', cyber: 'core',
  },
  '2.5a': null,
  '2.6': { banking: 'pb', mortgage: 'partner', retirement: 'none', 'business-banking': 'jpm' },
  '3.1': { base: 25, banking: 30, mortgage: 35, retirement: 25, insurance: 30, alternatives: 40, four: 45 },
  '3.2': ['safety', 'performance', 'app'],
  '3.3': ['brand', 'offices', 'meetings', 'calls-first', 'leaders', 'events', 'intellectual-capital', 'first-look', 'gifts', 'next-gen'],
  '4.1': { mm: 3 },
  '4.1a': 'take-anyway',
  '4.2': 'never',
  '4.3': {
    banker: 'every', investor: 'every', wa: 'none', ca: 'none', css: 'every', 'specialist-advice': 'above',
    'wealth-plan': 'above', 'annual-review': 'every', events: 'none', 'remote-opening': 'every',
  },
  '4.3a': null,
  '4.4': 'move',
  '5.1': { split: 10, jpm: 2, champion: 6, global: 2 },
  '5.2': null,
  '5.2a': 'global',
  '5.3': {
    'day-to-day': 'local', salary: 'local', 'home-loan': 'local', 'local-deposits': 'local', 'usd-deposits': 'either',
    'local-shares': 'local', advice: 'either', lombard: 'either', alternatives: 'jpm', succession: 'local',
  },
  '5.3a': 'onshore',
  '5.4': { n: 0 },
  '5.4a': null,
  '6.1': 'virtual',
  '6.1a': { n: 150 },
  '6.2': { first: 0, after: 0 },
  '6.2a': null,
  '6.2b': 'any',
  '6.3': {
    technical: 'core', eq: 'critical', book: 'not-hnw', opener: 'nice', 'local-network': 'nice', language: 'core',
    orchestrator: 'core', digital: 'critical', judgement: 'critical', 'next-gen': 'nice', disciplined: 'core', coachable: 'core',
  },
  '6.3a': null,
  '6.4': { md: 0, ed: 2, vp: 5, associate: 3 },
  '6.4a': { n: 4 },
  '7.1': 30,
  '7.2': {
    'remote-opening': 'core', 'one-view': 'core', aggregation: 'nice', 'in-app-chat': 'core', whatsapp: 'not-hnw',
    video: 'core', fx: 'nice', 'credit-line': 'nice', 'self-plan': 'not-hnw', 'ai-assistant': 'nice', 'one-login': 'core', language: 'nice',
  },
  '7.2a': null,
  '7.3': 'helper',
  '7.4': {
    onboarding: 'person-ai', kyc: 'person', suitability: 'person', proposal: 'person-ai', meetings: 'ai-drafts',
    servicing: 'ai-drafts', monitoring: 'person-ai', maintenance: 'ai-drafts',
  },
  '7.4a': { n: 90 },
  '8.1': {
    'free-online': 'do', 'free-all': 'never', 'free-crypto': 'never', 'promo-deposit': 'never', 'cash-rate': 'never',
    'retros-back': 'never', 'all-in': 'never', membership: 'never', 'price-list': 'never', 'relationship-lending': 'never',
    'no-fx-markup': 'never', 'no-custody': 'never',
  },
  '8.1a': null,
  '8.2': 'salary',
  '8.2a': 'own-plan',
  '8.3': { 'team-pay': 'never', 'salary-only': 'pilot', 'nnm-bonus': 'never', 'hire-guarantee': 'do', 'satisfaction-bonus': 'pilot' },
  '8.4': 'one-off',
  '8.4a': null,
  '8.4b': 'nothing',
  '9.1': ['service-model', 'talent', 'pricing', 'onboarding', 'products', 'referrals', 'digital', 'pay', 'training', 'bandwidth'],
  '9.2': {
    bandwidth: 'fixable', digital: 'gap', talent: 'ready', training: 'fixable', referrals: 'gap', pay: 'fixable',
    onboarding: 'gap', pricing: 'ready', products: 'fixable', 'service-model': 'fixable',
  },
  '9.3': 'private-bank',
  '9.4': { n: 2500 },
  '9.4a': '6-7',
  '9.4b': { region: '', market: 'Kenya' },
  '10.1': {
    excited: 'An offer simple enough to explain on one page.',
    nervous: 'That bankers keep their best time for the largest clients.',
  },
  '10.2': { fear: 'Building our own version of tools the group already has.' },
  '10.3': { name: 'no one', why: '' },
  '10.4': null,
  '10.5': {
    headline: 'J.P. Morgan widens its private bank to clients from $5mm',
    quote: 'Clients told us what they wanted, and we built it with our bankers.',
  },
}

/** The second sample respondent's answers: { stepId: value or null } for every step that saves an answer. */
export function secondAnswers(script) {
  const A = {}
  for (const s of script.steps) {
    if (!storing(s)) continue
    if (!(s.id in SECOND)) throw new Error(`sample-answers: no second-respondent answer for step ${s.id}`)
    A[s.id] = clone(SECOND[s.id])
  }
  return A
}

/* 2.6: the tray for each tile (only the tiles the screen offers are kept, in this order) */
const TRAYS_2_6 = { banking: 'jpm', mortgage: 'pb', insurance: 'partner', retirement: 'partner', crypto: 'none', 'business-banking': 'jpm' }
/* 4.3a: the amount ($mm) for each role (only the roles stamped Only above an amount on 4.3 are kept) */
const AMOUNTS_4_3A = { banker: 10, investor: 12.5, wa: 15, ca: 15, css: 7.5 }

const clone = (v) => JSON.parse(JSON.stringify(v))
const storing = (s) => !['flow', 'break'].includes(s.template)

/** { stepId: value } for every step that saves an answer, in play order. */
export function sampleAnswers(script) {
  const A = {}
  for (const s of script.steps) {
    if (!storing(s)) continue
    const D = s.data || {}
    if (D.sample !== undefined) A[s.id] = clone(D.sample)
    else if (WRITTEN[s.id] !== undefined) A[s.id] = clone(WRITTEN[s.id])
    else A[s.id] = derived(s, A)
  }
  return A
}

function derived(s, A) {
  const D = s.data || {}
  if (s.template === 'podium' && D.optionsFrom) {
    const parent = A[D.optionsFrom.step]
    return Object.keys(parent).filter((k) => parent[k] === D.optionsFrom.pile).slice(0, 3)
  }
  if (s.template === 'trays' && D.tilesFrom) {
    const src = A[D.tilesFrom.step]
    const out = {}
    D.tiles.filter((t) => t.always || src[t.id] !== D.tilesFrom.excludePile).forEach((t) => { out[t.id] = TRAYS_2_6[t.id] })
    return out
  }
  if (s.template === 'sentence' && D.rowsFrom) {
    const src = A[D.rowsFrom.step]
    const out = {}
    D.rowsFrom.roles.filter((r) => src[r] === D.rowsFrom.stamp).forEach((r) => { out[r] = AMOUNTS_4_3A[r] })
    return out
  }
  if (s.template === 'stamp' && D.mode === 'pick-line') {
    const src = A[D.optionsFrom.step]
    const live = Object.keys(src).filter((k) => D.optionsFrom.stamps.includes(src[k]))
    return live.includes('cash-rate') ? 'cash-rate' : live[0]
  }
  throw new Error(`sample-answers: no answer for step ${s.id}; add one to WRITTEN`)
}
