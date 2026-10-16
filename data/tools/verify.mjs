#!/usr/bin/env node
/*
 * Checks for tools/flatten.mjs, and for a database loaded with sql/01-03 (run by tools/check-on-postgres.sh).
 *
 *   Without a database:
 *     1. validate() refuses malformed answers, marks partial ones incomplete, and accepts the edge cases the screens
 *        allow (Never on 4.2, nothing to place on 5.2, Another market without a region, 10.4 left empty, wave 2)
 *     2. shows() fires and holds back each conditional step as script.js says
 *     3. flatten() gives the documented rows for the special shapes
 *   With the database (PG* variables set: PGHOST, PGPORT, PGUSER, PGDATABASE; psql from $PSQL or on PATH):
 *     4. the loaded seed equals script.js, character for character
 *     5. both sample runs, read back from value_json: each answer equals its sample (key order included), shows()
 *        equals answer.shown, a row not shown has no value, and validate() with the run's other answers is complete
 *     6. flatten() of every stored value_json equals the stored answer_item rows, row for row, run by run
 *     7. every stored answer_event value is well formed (a draft may be incomplete, never malformed)
 *     8. the documented rebuild of answer_item for a submitted run (R000002), with flatten() and the trigger handling
 *
 *   node tools/verify.mjs           (exits 1 on the first failure)
 */
import { execFileSync } from 'node:child_process'
import { loadScript } from './load-script.mjs'
import { flatten, validate, shows } from './flatten.mjs'
import { sampleAnswers, secondAnswers } from './sample-answers.mjs'

const { script } = loadScript()
const STEPS = script.steps
const BY_ID = Object.fromEntries(STEPS.map((s) => [s.id, s]))
const SAMPLE = sampleAnswers(script)
let checks = 0
function ok(cond, what) {
  if (!cond) { console.error(`FAILED  ${what}`); process.exit(1) }
  checks++
}
const clone = (v) => JSON.parse(JSON.stringify(v))
const withAnswers = (patch) => ({ steps: STEPS, answers: Object.assign(clone(SAMPLE), patch || {}) })

/* ---------------------------------------------------------------------------------------------- 1. validate() */

const v81 = (patch) => Object.assign(clone(SAMPLE['8.1']), patch)
const NOT_ALL_FOUR = { execute: { belongs: 'core', covers: [], who: 'online' }, engage: { belongs: 'not-hnw', covers: [], who: null }, entrust: { belongs: 'not-hnw', covers: [], who: null } }
const NO_ROLE_ABOVE = { banker: 'every', investor: 'none', wa: 'every', ca: 'none', css: 'every', 'specialist-advice': 'every', 'wealth-plan': 'above', 'annual-review': 'every', events: 'above', 'remote-opening': 'every' }
const CASES = [
  // [step, value, expected: 'error' | 'incomplete' | 'complete', what, answers to patch into the sample, ctx extras,
  //  words expected in the notes]
  ['W', 'hello', 'error', 'a step that saves nothing'],
  ['1.1', ['goals'], 'error', 'a list where one id is saved'],
  ['1.1', 'plan', 'error', 'an unknown option'],
  ['2.1', { r1: 'x'.repeat(281), r2: 'fine', r3: 'fine' }, 'error', 'a quote over 280 characters'],
  ['2.1', { r1: 'Trust', r2: 'ok' }, 'incomplete', 'a quote under 3 characters, one missing'],
  ['2.2', { securities: 'critical', banana: 'core' }, 'error', 'an unknown card'],
  ['2.2', { securities: 'somewhere' }, 'error', 'an unknown pile'],
  ['2.2', { securities: 'critical' }, 'incomplete', 'a partial card sort'],
  ['2.2', {}, 'error', 'an empty object (never saved)'],
  ['2.2a', ['crypto', 'securities', 'lombard'], 'error', 'a pick not in the Critical pile of 2.2'],
  ['2.2a', ['securities', 'securities', 'lombard'], 'error', 'a pick made twice'],
  ['2.2a', ['securities', 'lombard', 'retirement', 'alternatives'], 'error', 'four places'],
  ['2.2a', ['securities'], 'error', 'one place (a podium saves three, null for an empty one)'],
  ['2.2a', [null, 'securities', null], 'incomplete', 'a podium with empty places'],
  ['2.2a', ['securities', 'alternatives', 'lombard'], 'complete', 'a stale top 3 once Critical holds three cards (not shown)', { '2.2': Object.assign(clone(SAMPLE['2.2']), { retirement: 'core' }) }, null, 'not shown'],
  ['2.3', { execute: { belongs: 'core', covers: ['crypto'], who: 'online' } }, 'error', 'a product put in Not for HNW on 2.2'],
  ['2.3', { execute: { belongs: 'core', covers: ['funds'], who: 'central' } }, 'error', 'a who option meant for Engage and Entrust only'],
  ['2.3', { engage: { belongs: 'not-hnw', covers: ['funds'], who: null } }, 'error', 'Not for HNW with a product ticked'],
  ['2.3', NOT_ALL_FOUR, 'incomplete', 'Execute with no product ticked'],
  ['2.3', NOT_ALL_FOUR, 'complete', 'no product ticked and 2.2 not supplied: the minimum is not checked', { '2.2': undefined }, null, 'not checked'],
  ['2.3', { execute: { belongs: 'core', covers: ['funds'], who: 'online' }, engage: { belongs: 'not-hnw', covers: [], who: null }, entrust: { belongs: 'not-hnw', covers: [], who: null } }, 'complete', 'Engage and Entrust both Not for HNW'],
  ['2.6', { crypto: 'pb' }, 'error', 'a tile not offered (crypto is Not for HNW on 2.2)'],
  ['2.6', { 'business-banking': 'jpm' }, 'incomplete', 'four offered tiles not placed'],
  ['2.6', { 'business-banking': 'jpm' }, 'complete', 'only the always-offered tile required when 2.2 is not supplied', { '2.2': undefined }, null, 'always offered'],
  ['2.6', { banking: 'jpm', mortgage: 'pb', insurance: 'partner', retirement: 'partner', 'business-banking': 'jpm' }, 'complete', 'every offered tile placed'],
  ['3.1', { base: 40, banking: 30 }, 'error', 'a row below today\'s share'],
  ['3.1', { base: 40 }, 'incomplete', 'rows and all four not set'],
  ['3.3', [], 'error', 'an empty ranking (never saved)'],
  ['4.1', { mm: 0 }, 'incomplete', 'a number below the range, as while typing 0.5'],
  ['4.1', { mm: 5.25 }, 'error', 'more decimals than the box takes'],
  ['4.2', 'never', 'complete', 'Never'],
  ['4.2', 'sometimes', 'error', 'a string other than never'],
  ['4.2', { mm: 15 }, 'incomplete', 'no word picked'],
  ['4.3a', { ca: 10 }, 'error', 'a role not stamped Only above an amount on 4.3'],
  ['4.3a', { banker: 10 }, 'incomplete', 'one of the two roles stamped above'],
  ['4.3a', { banker: 10 }, 'complete', 'a stale amount once no role is stamped above (not shown)', { '4.3': NO_ROLE_ABOVE }, null, 'not shown'],
  ['5.1', { split: 4, jpm: 1 }, 'incomplete', 'rows short of the split'],
  ['5.1', { split: 4, jpm: 11 }, 'error', 'an amount over $10mm'],
  ['5.1', { split: 0, jpm: 1, champion: 3 }, 'complete', 'old amounts behind the closed column at split 0', null, null, 'ignored'],
  ['5.1', { jpm: 1 }, 'incomplete', 'no split typed (its rows are ignored)', null, null, 'ignored'],
  ['5.2', { jpm: 3 }, 'incomplete', 'investments short of $10mm less the split'],
  ['5.2', null, 'complete', 'nothing to place when the split is 10', { '5.1': { split: 10 } }],
  ['5.2', { jpm: 3, global: 2 }, 'complete', 'old amounts when the split is 10', { '5.1': { split: 10 } }, null, 'ignored'],
  ['5.2', { jpm: 3 }, 'complete', '5.1 not supplied: the total is not checked', { '5.1': undefined }, null, 'not checked'],
  ['5.2', null, 'incomplete', 'no answer when there is something to place'],
  ['5.4a', { existing: 95 }, 'incomplete', 'shares adding up to 95'],
  ['5.4a', { existing: 100.5 }, 'error', 'a share that is not a whole number'],
  ['5.4a', {}, 'error', 'an empty object (never saved)'],
  ['6.2a', ['home', 'business', 'venue'], 'error', 'three picks where two are allowed'],
  ['6.2a', [], 'error', 'an empty list (never saved)'],
  ['6.4', { md: 5, ed: 6, vp: 0, associate: 0 }, 'error', 'more than 10 bankers'],
  ['6.4', { md: 5, ed: 4 }, 'error', 'jugs missing (all four are always saved)'],
  ['6.4', { md: 5, ed: 4, vp: 0, associate: 0 }, 'incomplete', '9 bankers placed'],
  ['7.1', 65, 'error', 'a number that is not a stop'],
  ['7.1', '60', 'error', 'the per cent saved as a string'],
  ['7.3', 'robot', 'error', 'an unknown stop'],
  ['8.1a', 'free-all', 'error', 'a card stamped Never on 8.1'],
  ['8.1a', 'not-a-card', 'error', 'an unknown card'],
  ['8.1a', 'price-list', 'complete', 'the price-list card stamped Do it, in wave 1', { '8.1': v81({ 'price-list': 'do' }) }],
  ['8.1a', 'price-list', 'error', 'the price-list card in wave 2', { '8.1': v81({ 'price-list': 'do' }) }, { wave: 2 }],
  ['8.1', v81({ 'price-list': 'never' }), 'error', 'the price-list card in wave 2', null, { wave: 2 }],
  ['8.1', (() => { const v = clone(SAMPLE['8.1']); delete v['price-list']; return v })(), 'complete', '11 cards in wave 2', null, { wave: 2 }],
  ['8.2', 'scorecard', 'complete', 'a wave-1 step in wave 2: not shown, the value is ignored', null, { wave: 2 }, 'not shown'],
  ['8.2a', 'separate', 'error', 'a fallback option while the fallback is not in use'],
  ['8.2a', 'separate', 'complete', 'a fallback option with ctx.fallback', null, { fallback: true }],
  ['9.1', ['talent', 'talent'], 'error', 'a block placed twice'],
  ['9.1', ['talent', 'pay'], 'incomplete', 'two of ten placed'],
  ['9.4b', { region: 'mars', market: 'Olympus' }, 'error', 'an unknown region'],
  ['9.4b', { region: 'asia', market: '' }, 'incomplete', 'a region and no market'],
  ['9.4b', { region: '', market: 'Kenya' }, 'complete', 'Another market typed without a region'],
  ['9.4b', { region: '', market: ' Kenya' }, 'error', 'an untrimmed market (the page trims it)'],
  ['9.4b', { region: 'asia', market: 'K' }, 'incomplete', 'Another market under 2 characters'],
  ['10.3', { name: 'no one', why: '' }, 'complete', "the chip's 'no one'"],
  ['10.4', null, 'complete', '10.4 left empty (optional)'],
  ['10.5', { headline: 'Too short', quote: 'A quote that is long enough' }, 'incomplete', 'a headline under 10 characters'],
  ['10.5', { headline: 'Ten\n\nchars', quote: 'A quote that is long enough' }, 'incomplete', 'a headline of 9 characters once its line breaks become a space'],
  ['10.5', { headline: 'A headline that is fine', quote: '“  Hi  ”' }, 'incomplete', 'a quote of 2 characters once its quote marks go'],
  ['10.5', { headline: 'A headline that is fine', quote: '"A quote long enough"' }, 'complete', 'a quote in quote marks'],
  ['10.5', { headline: 'x'.repeat(111), quote: 'A quote that is long enough' }, 'error', 'a headline over 110 characters'],
]
for (const [id, value, want, what, patch, extra, note] of CASES) {
  const r = validate(BY_ID[id], value, Object.assign(withAnswers(patch), extra || {}))
  const got = !r.ok ? 'error' : r.complete ? 'complete' : 'incomplete'
  ok(got === want, `validate ${id} (${what}): expected ${want}, got ${got} ${JSON.stringify(r.errors.concat(r.incomplete))}`)
  if (note) ok(r.notes.join(' ').includes(note), `validate ${id} (${what}): expected a note with '${note}', got ${JSON.stringify(r.notes)}`)
}
console.log(`ok  validate(): ${CASES.length} cases (malformed and never-saved shapes refused, partial marked incomplete, edge cases accepted)`)

/* ------------------------------------------------------------------------------------------------- 2. shows() */

const SHOWS = [
  ['2.2a', { '2.2': { securities: 'critical', funds: 'critical', lombard: 'critical', banking: 'core' } }, false, 'three cards in Critical'],
  ['2.2a', {}, true, "the sample's four cards in Critical"],
  ['2.4', { '2.3': { execute: { belongs: 'core' }, engage: { belongs: 'not-hnw' }, entrust: { belongs: 'not-hnw' } } }, false, 'Engage and Entrust Not for HNW'],
  ['2.4a', { '2.3': { execute: { belongs: 'core' }, engage: { belongs: 'not-hnw' }, entrust: { belongs: 'nice' } } }, true, 'Entrust offered'],
  ['4.3a', { '4.3': { banker: 'every', investor: 'none', wa: 'every', ca: 'none', css: 'every', events: 'above' } }, false, 'only a non-role card stamped above'],
  ['5.4a', { '5.4': { n: 0 } }, false, '5.4 is 0'],
  ['6.2a', { '6.2': { first: 0, after: 0 } }, false, 'no meetings'],
  ['6.2a', { '6.2': { first: 0, after: 1 } }, true, 'one meeting a year after'],
  ['8.1a', { '8.1': { 'free-online': 'do', 'free-all': 'never' } }, false, 'one card stamped Do it'],
  ['8.4a', { '8.4': 'one-off' }, false, 'not a revenue share'],
  ['8.4a', { '8.4': 'trailer' }, true, 'a revenue share'],
  ['2.2', {}, true, 'an unconditional step'],
]
for (const [id, patch, want, what] of SHOWS) {
  ok(shows(BY_ID[id], Object.assign(clone(SAMPLE), patch)) === want, `shows ${id} (${what}): expected ${want}`)
}
ok(shows(BY_ID['8.2'], SAMPLE, { wave: 2 }) === false, 'shows 8.2 in wave 2: expected false')
ok(shows(BY_ID['5.4a'], {}) === null, 'shows 5.4a without 5.4: expected null')
console.log(`ok  shows(): ${SHOWS.length + 2} cases`)

/* ------------------------------------------------------------------------------------------------ 3. flatten() */

const rowsOf = (id, v, ctx) => flatten(BY_ID[id], v, ctx).map((r) => [r.item_id, r.attribute, r.value_text, r.value_number, r.seq])
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const FLAT = [
  ['9.4b', { region: '', market: 'Kenya' }, null, [['other', 'market', 'Kenya', null, 1]], '9.4b Another market'],
  ['9.4b', { region: 'asia', market: 'Singapore' }, null, [['asia', 'region', null, null, 1], ['Singapore', 'market', 'Singapore', null, 1]], '9.4b a listed market'],
  ['9.4b', { region: 'emea', market: 'Singapore' }, null, [['emea', 'region', null, null, 1], ['other', 'market', 'Singapore', null, 1]], "9.4b a market not in the region's list is Another market"],
  ['4.2', 'never', null, [['never', 'opt_out', null, null, 1]], '4.2 Never'],
  ['2.2a', [null, 'funds', null], null, [['funds', 'rank', null, 2, 2]], 'a podium with empty places'],
  ['7.1', 60, null, [['60', 'percent', null, 60, 1]], '7.1'],
  ['2.4', 'full-range', null, [['full-range', 'stop', null, 4, 1]], "2.4: a stop's position"],
  ['10.1', { excited: '  More clients. ', nervous: '' }, null, [['excited', 'text', 'More clients.', null, 1]], 'text: trimmed, an empty field gives no row'],
  ['10.3', { name: 'no one', why: '' }, null, [['name', 'text', 'no one', null, 1], ['name', 'chip', 'no one', null, 1]], '10.3: the chip gives a chip row'],
  ['10.3', { name: 'UBS', why: '' }, null, [['name', 'text', 'UBS', null, 1]], '10.3: a typed name gives no chip row'],
  ['10.5', { headline: 'A  headline\nwith breaks', quote: '"Quoted words here"' }, null, [['headline', 'text', 'A headline with breaks', null, 1], ['quote', 'text', 'Quoted words here', null, 2]], '10.5: cleaned as the page cleans it'],
  ['2.2', { lombard: 'core', securities: 'critical' }, null, [['lombard', 'pile', 'core', null, 1], ['securities', 'pile', 'critical', null, 2]], 'piles: seq is the order placed'],
  ['2.3', { engage: { belongs: 'not-hnw', covers: [], who: null } }, null, [['engage', 'belongs', 'not-hnw', null, 1]], '2.3 Not for HNW'],
  ['5.1', { split: 0, jpm: 1 }, null, [['split', 'amount_mm', null, 0, 1]], '5.1: amounts behind the closed column at split 0 give no rows'],
  ['5.2', { jpm: 3 }, { answers: { '5.1': { split: 10 } } }, [], "5.2: nothing to place (5.1's split 10), so no rows"],
  ['5.2', { jpm: 3 }, null, [['jpm', 'amount_mm', null, 3, 1]], "5.2 without 5.1's answer: rows kept"],
  ['10.4', null, null, [], 'no value, no rows'],
]
for (const [id, v, fctx, want, what] of FLAT) ok(same(rowsOf(id, v, fctx || {}), want), `flatten ${what}: got ${JSON.stringify(rowsOf(id, v, fctx || {}))}`)
console.log(`ok  flatten(): ${FLAT.length} special shapes`)

/* ------------------------------------------------------------------------------------------- 4-6. the database */

if (!process.env.PGDATABASE && !process.env.PGHOST) {
  console.log('(no database: set PGHOST, PGPORT, PGUSER and PGDATABASE to check one)')
  console.log(`verify: ${checks} checks passed`)
  process.exit(0)
}
const PSQL = process.env.PSQL || 'psql'
function sqlJson(query) {
  const out = execFileSync(PSQL, ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' })
  return JSON.parse(out.trim() || 'null') || []
}
/* The seed as loaded equals script.js, character for character (quotes, ellipses, accents and line breaks survive) */
const dbSteps = sqlJson(`SELECT json_agg(json_build_object('step_id', step_id, 'seq', seq, 'kind', kind, 'template', template,
  'chapter', chapter, 'parent', parent_step_id, 'title', title, 'bridge', bridge, 'question', question, 'instruction', instruction,
  'notes', notes, 'cond', show_condition, 'store', store, 'rule', completion_rule, 'w1', wave1_only) ORDER BY seq) FROM step WHERE version = 'v3'`)
ok(dbSteps.length === STEPS.length, `${STEPS.length} steps loaded`)
STEPS.forEach((s, i) => {
  const d = dbSteps[i]
  const want = [s.id, i + 1, s.kind, s.template, s.chapter || null, s.parent || null, s.title, s.bridge || null, s.question || null,
    s.instruction || null, (s.notes || []).length ? s.notes.join('\n') : null, s.previewCondition || null,
    (s.data && s.data.store) || null, s.rule || null, !!s.sensitive]
  const got = [d.step_id, d.seq, d.kind, d.template, d.chapter, d.parent, d.title, d.bridge, d.question, d.instruction, d.notes,
    d.cond, d.store, d.rule, d.w1]
  ok(same(want, got), `step ${s.id} loaded as script.js has it: ${JSON.stringify(got)}`)
})
const dbOptions = sqlJson(`SELECT json_agg(json_build_object('step_id', step_id, 'set', option_set, 'id', option_id, 'label', label, 'hint', hint))
  FROM step_option WHERE version = 'v3'`)
let labelled = 0
STEPS.forEach((s) => {
  const D = s.data || {}
  ;['cards', 'piles', 'options', 'stops', 'trays', 'tiles', 'rows', 'blocks', 'stamps', 'jugs', 'items', 'regions'].forEach((k) => {
    if (!Array.isArray(D[k]) || !D[k].length || typeof D[k][0] !== 'object' || !D[k][0].id || !D[k][0].label) return
    D[k].forEach((o) => {
      const row = dbOptions.find((x) => x.step_id === s.id && x.id === String(o.id) && x.label === o.label)
      ok(!!row, `${s.id} ${k} '${o.id}' loaded with label ${JSON.stringify(o.label)}`)
      ok(row.hint === (o.hint != null ? o.hint : o.gloss != null ? o.gloss : null), `${s.id} ${k} '${o.id}' loaded with its hint`)
      labelled++
    })
  })
})
console.log(`ok  the loaded seed equals script.js: ${STEPS.length} steps (every text column), ${labelled} option labels and hints`)

/* Both sample runs, as stored: each answer read back from value_json and checked against the rules and the samples */
const SAMPLE_OF = { R000001: SAMPLE, R000002: secondAnswers(script) }
const key = (r) => [r.step_id, r.item_id, r.attribute, r.value_text, r.value_number == null ? null : Number(r.value_number), r.seq].join('\u0001')
const runs = sqlJson(`SELECT json_agg(json_build_object('sid', r.sid, 'submission_id', s.submission_id, 'status', s.status, 'version', s.version) ORDER BY r.sid)
  FROM submission s JOIN respondent r ON r.respondent_id = s.respondent_id`)
ok(runs.length === 2 && runs.every((r) => r.status === 'submitted' && r.version === 'v3'), `two submitted v3 runs (found ${JSON.stringify(runs)})`)
let nAnswers = 0
let nHidden = 0
let nItems = 0
let nEvents = 0
for (const run of runs) {
  const SUB = `'${run.submission_id}'`
  const answers = sqlJson(`SELECT json_agg(json_build_object('step_id', a.step_id, 'value_json', a.value_json, 'shown', a.shown) ORDER BY st.seq)
    FROM answer a JOIN step st ON st.version = a.version AND st.step_id = a.step_id WHERE a.submission_id = ${SUB}`)
  const items = sqlJson(`SELECT json_agg(json_build_object('step_id', step_id, 'item_id', item_id, 'attribute', attribute,
    'value_text', value_text, 'value_number', value_number, 'seq', seq)) FROM answer_item WHERE submission_id = ${SUB}`)
  const events = sqlJson(`SELECT json_agg(json_build_object('step_id', step_id, 'revision', revision, 'value_json', value_json,
    'committed', committed) ORDER BY event_id) FROM answer_event WHERE submission_id = ${SUB}`)
  ok(answers.length === 63, `${run.sid}: 63 answer rows (found ${answers.length})`)
  const STORED = {}
  answers.forEach((a) => { STORED[a.step_id] = a.value_json == null ? null : JSON.parse(a.value_json) })
  const dbCtx = { steps: STEPS, answers: STORED }
  for (const a of answers) {
    const step = BY_ID[a.step_id]
    ok(shows(step, STORED, dbCtx) === a.shown, `${run.sid}: shows(${a.step_id}) equals answer.shown (${a.shown})`)
    if (!a.shown) ok(a.value_json == null, `${run.sid}: ${a.step_id} is not shown, so it has no value`)
    const r = validate(step, STORED[a.step_id], dbCtx)
    ok(r.ok && r.complete, `${run.sid}: validate() on stored ${a.step_id}: ${r.errors.concat(r.incomplete).join('; ')}`)
    const want = SAMPLE_OF[run.sid][a.step_id]
    ok(JSON.stringify(STORED[a.step_id]) === JSON.stringify(want === undefined ? null : want), `${run.sid}: stored ${a.step_id} equals the sample, key order included`)
  }
  const want = []
  for (const a of answers) if (a.shown) flatten(BY_ID[a.step_id], STORED[a.step_id], dbCtx).forEach((r) => want.push(key(Object.assign({ step_id: a.step_id }, r))))
  const got = items.map(key)
  want.sort()
  got.sort()
  ok(want.length === got.length && same(want, got), `${run.sid}: flatten(stored value_json) equals stored answer_item (${want.length} vs ${got.length} rows)`)
  for (const e of events) {
    const r = validate(BY_ID[e.step_id], e.value_json == null ? null : JSON.parse(e.value_json), dbCtx)
    ok(r.ok, `${run.sid}: answer_event ${e.step_id} revision ${e.revision} is well formed: ${r.errors.join('; ')}`)
    if (e.committed) ok(r.complete, `${run.sid}: committed answer_event ${e.step_id} revision ${e.revision} is complete`)
  }
  nAnswers += answers.length
  nHidden += answers.filter((a) => !a.shown).length
  nItems += got.length
  nEvents += events.length
}
console.log(`ok  both runs: ${nAnswers} stored answers (${nHidden} not shown, no value) equal the samples, key order kept; shows() equals answer.shown; validate() complete on every one`)
console.log(`ok  flatten() of the stored value_json gives the stored answer_item rows: ${nItems} rows`)
console.log(`ok  answer_event: ${nEvents} saves well formed, every commit complete`)

/* The documented rebuild of answer_item for a submitted run ("Rebuilding answer_item"), done for real on R000002:
   flatten() with { steps, answers } for every shown answer, written in one transaction that disables
   tg_answer_item_submitted and enables it again before COMMIT */
{
  const run = runs.find((r) => r.sid === 'R000002')
  const SUB = `'${run.submission_id}'`
  const answers = sqlJson(`SELECT json_agg(json_build_object('step_id', step_id, 'value_json', value_json, 'shown', shown)) FROM answer WHERE submission_id = ${SUB}`)
  const STORED = {}
  answers.forEach((a) => { STORED[a.step_id] = a.value_json == null ? null : JSON.parse(a.value_json) })
  const ctx = { steps: STEPS, answers: STORED }
  const rows = []
  answers.filter((a) => a.shown).forEach((a) => flatten(BY_ID[a.step_id], STORED[a.step_id], ctx).forEach((r) => rows.push(Object.assign({ step_id: a.step_id }, r))))
  const lit = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
  const script = [
    'BEGIN;',
    `SELECT 1 FROM submission WHERE submission_id = ${SUB} FOR UPDATE;`,
    'LOCK TABLE answer_item IN EXCLUSIVE MODE;',
    'ALTER TABLE answer_item DISABLE TRIGGER tg_answer_item_submitted;',
    `DELETE FROM answer_item WHERE submission_id = ${SUB};`,
    ...rows.map((r) => `INSERT INTO answer_item (submission_id, step_id, item_id, attribute, value_text, value_number, seq) VALUES (${SUB}, ${lit(r.step_id)}, ${lit(r.item_id)}, ${lit(r.attribute)}, ${lit(r.value_text)}, ${r.value_number == null ? 'NULL' : r.value_number}, ${r.seq});`),
    'ALTER TABLE answer_item ENABLE TRIGGER tg_answer_item_submitted;',
    'COMMIT;',
  ].join('\n')
  execFileSync(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  const after = sqlJson(`SELECT json_agg(json_build_object('step_id', step_id, 'item_id', item_id, 'attribute', attribute,
    'value_text', value_text, 'value_number', value_number, 'seq', seq)) FROM answer_item WHERE submission_id = ${SUB}`).map(key).sort()
  ok(same(after, rows.map(key).sort()), `R000002 after the rebuild: answer_item equals flatten() (${after.length} vs ${rows.length} rows)`)
  ok(same(sqlJson("SELECT json_agg(tgenabled) FROM pg_trigger WHERE tgname = 'tg_answer_item_submitted'"), ['O']), 'tg_answer_item_submitted is enabled after the rebuild')
  let refused = ''
  try {
    execFileSync(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', `INSERT INTO answer_item (submission_id, step_id, item_id, attribute, seq) VALUES (${SUB}, '1.1', 'advice', 'choice', 2)`], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (e) { refused = String(e.stderr || '') }
  ok(/cannot change/.test(refused), `R000002 still refuses a new answer_item row after the rebuild (${refused.trim() || 'it was accepted'})`)
  console.log(`ok  the documented rebuild of answer_item on submitted R000002: ${rows.length} rows from flatten() in one transaction; trigger enabled again; the run still refuses writes`)
}
console.log(`verify: ${checks} checks passed`)
