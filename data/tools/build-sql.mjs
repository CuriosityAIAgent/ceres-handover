#!/usr/bin/env node
/*
 * Build the generated parts of the Ceres data package from questionnaire/v3/script.js:
 *
 *   sql/02-questionnaire-v3.sql    the questionnaire row, its 77 steps and every option (step_option)
 *   sql/03-sample-respondent.sql   two sample respondents (R000001 sees every step; R000002 none of the conditional
 *                                  ones), each a submitted run: answer, answer_item, answer_event
 *   sql/05-checks.sql              self-checks to run after 01-04 (counts from script.js, joins, constraint and
 *                                  trigger tests, the save rules, every 04 query returns rows, some 04 values)
 *   data-dictionary.md             its generated sections: tables and columns (from sql/01-schema.sql), the
 *                                  option_set vocabulary, and one row per step
 *
 * Deterministic: no clock and no random numbers (the samples' UUIDs are fixed literals). The same script.js, 01 and 04
 * give the same files, byte for byte.
 *
 *   node tools/build-sql.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadScript, DATA_DIR } from './load-script.mjs'
import { flatten, validate, shows, refs, storesAnswer, CONDITIONS, ATTRIBUTES } from './flatten.mjs'
import { sampleAnswers, secondAnswers } from './sample-answers.mjs'

const VERSION = 'v3'
const LABEL = "Ceres HNW leadership survey, third draft (after Adam's and Chris's notes, 15 Oct 2026)"
const RELEASED = '2026-10-15'

const SQL_DIR = path.join(DATA_DIR, 'sql')
const OPTION_SETS = ['option', 'fallback', 'region', 'market', 'other', 'field', 'chip', 'suggestion', 'card', 'pile',
  'item', 'part', 'part_option', 'stop', 'end', 'tray', 'tile', 'row', 'column', 'block', 'slot', 'opt_out', 'role',
  'stamp', 'jug']

const { script, sha256, file: scriptFile } = loadScript()
const STEPS = script.steps
const BY_ID = Object.fromEntries(STEPS.map((s) => [s.id, s]))
const ROOT = path.resolve(DATA_DIR, '../../..')
const rel = (f) => path.relative(ROOT, f)

/* ---------------------------------------------- SQL literals (change these to write another dialect's literals) */

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const num = (v) => (v == null ? 'NULL' : String(v))
const bool = (v) => (v ? 'TRUE' : 'FALSE')
const ts = (ms) => `'${new Date(ms).toISOString().replace('T', ' ').replace('.000Z', '+00')}'`
const json = (v) => (v == null ? 'NULL' : q(JSON.stringify(v)))
const date = (d) => `DATE '${d}'`


function fail(msg) { console.error(`build-sql: ${msg}`); process.exit(1) }

/* ============================================================================================ steps and options */

function stepRow(s, seq) {
  return {
    version: VERSION, step_id: s.id, seq, kind: s.kind, template: s.template, chapter: s.chapter || null,
    parent_step_id: s.parent || null, title: s.title, bridge: s.bridge || null, question: s.question || null,
    instruction: s.instruction || null, notes: (s.notes || []).length ? s.notes.join('\n') : null,
    show_condition: s.previewCondition || null, store: (s.data && s.data.store) || null,
    completion_rule: s.rule || null, wave1_only: !!s.sensitive,
  }
}

const BASE_KEYS = ['id', 'label', 'hint', 'gloss', 'group']
function extraOf(o, drop) {
  const e = {}
  Object.keys(o).forEach((k) => { if (!BASE_KEYS.includes(k) && !drop.includes(k) && o[k] !== undefined) e[k] = o[k] })
  return Object.keys(e).length ? e : null
}
/* A sentence with each slot shown as [id], with its prefix and suffix: "At $[mm]mm in balances with us, I would [verb] ..." */
const sentenceText = (parts) => parts.map((p) => (typeof p === 'string' ? p : `${p.prefix || ''}[${p.id}]${p.suffix || ''}`)).join('')

/** The step_option rows of one step: { set, id, label, hint, grp, parent, seq, extra }. */
function optionRows(step) {
  const D = step.data || {}
  const rows = []
  const list = (set, items, { parent = null, drop = [] } = {}) => items.forEach((o, i) => rows.push({
    set,
    id: String(o.id),
    label: o.label == null ? null : String(o.label),
    hint: o.hint != null ? o.hint : o.gloss != null ? o.gloss : null,
    grp: o.group != null ? o.group : null,
    parent,
    seq: i + 1,
    extra: extraOf(o, drop),
  }))
  switch (step.template) {
    case 'checklist':
      if (D.mode === 'region-market') {
        list('region', D.regions, { drop: ['markets'] })
        D.regions.forEach((r) => list('market', r.markets.map((m) => ({ id: m, label: m })), { parent: r.id }))
        list('other', [D.other])
      } else {
        list('option', D.options)
        if (D.fallback) list('fallback', D.fallback.options)
      }
      break
    case 'text': {
      const label = (f) => f.stem || (f.inSentence && D.sentence ? `${D.sentence.pre} ________${D.sentence.post}` : step.question)
      list('field', D.fields.map((f) => Object.assign({}, f, { label: label(f) })), { drop: ['stem'] })
      if (D.chip) list('chip', [{ id: D.chip.value || D.chip.label, label: D.chip.label }], { parent: D.chip.fills })
      if (D.typeahead) {
        const seen = new Map()
        Object.keys(D.typeahead).forEach((region) => D.typeahead[region].forEach((name) => {
          if (!seen.has(name)) seen.set(name, [])
          seen.get(name).push(region)
        }))
        list('suggestion', [...seen].map(([name, regions]) => ({ id: name, label: name, regions })), { parent: D.sentence ? D.sentence.field : null })
      }
      break
    }
    case 'newspaper':
      list('field', Object.keys(D.labels).map((k) => Object.assign({ id: k, label: D.labels[k] }, D.limits[k] || {})))
      break
    case 'piles':
      list('card', D.cards)
      list('pile', D.piles)
      break
    case 'podium':
      if (D.options) list('option', D.options)   // the top-3 follow-ups offer their parent's cards instead
      break
    case 'configure':
      list('item', D.items)
      list('part', D.parts.map((p) => ({ id: p.id, label: p.head, hint: p.question, mode: p.mode, min: p.min, optionsFrom: p.optionsFrom })))
      D.parts.forEach((p) => list('part_option', p.options, { parent: p.id }))
      break
    case 'track':
      list('stop', D.stops)
      if (D.ends) list('end', D.ends.map((t, i, a) => ({ id: i === 0 ? 'first' : i === a.length - 1 ? 'last' : String(i + 1), label: t })))
      break
    case 'trays':
      list('tray', D.trays)
      list('tile', D.tiles)
      break
    case 'ladder':
      list('row', D.rows)
      list('column', [
        { id: 'base', label: D.ui.todayTab.split(' · ')[0], hint: D.steps[0].question },
        { id: 'four', label: D.ui.step3Label, hint: D.steps[2].question },
      ])
      break
    case 'rank':
      list('block', D.blocks)
      break
    case 'sentence':
      if (D.rowsFrom) {
        const s = D.rowParts.find((p) => p && p.slot === 'number')
        list('role', D.rowsFrom.roles.map((r) => ({ id: r, label: D.roleWords[r], prefix: s.prefix, suffix: s.suffix, min: s.min, max: s.max, step: s.step, decimals: s.decimals })))
      } else {
        const slots = []
        D.rows.forEach((row) => row.parts.forEach((p) => { if (p && typeof p === 'object') slots.push({ p, row }) }))
        list('slot', slots.map(({ p, row }) => Object.assign({ kind: p.slot }, p, { label: sentenceText(row.parts) })), { drop: ['slot', 'options'] })
        slots.filter(({ p }) => p.slot === 'chips').forEach(({ p }) => list('chip', p.options, { parent: p.id }))
        if (D.optOut) list('opt_out', [D.optOut])
      }
      break
    case 'stamp':
      if (D.mode !== 'pick-line') {   // 8.1a offers 8.1's cards instead
        list('stamp', D.stamps)
        list('card', D.cards)
      }
      break
    case 'allocate-ledger':
      list('row', D.rows)
      if (D.split) {
        const s = D.split.parts.find((p) => p && typeof p === 'object')
        list('slot', [Object.assign({ kind: s.slot }, s, { label: sentenceText(D.split.parts) })], { drop: ['slot'] })
      }
      break
    case 'allocate-list':
      list('row', D.rows)
      break
    case 'bottle':
      list('jug', D.jugs)
      break
    default:
      break   // flow and break offer nothing
  }
  return rows
}

/** Option counts per set, read straight from script.js (a second reading, kept apart from optionRows, for 05). */
function expectedCounts(step) {
  const D = step.data || {}
  const c = {}
  const set = (k, n) => { if (n) c[k] = n }
  switch (step.template) {
    case 'checklist':
      if (D.regions) {
        set('region', D.regions.length)
        set('market', D.regions.reduce((t, r) => t + r.markets.length, 0))
        set('other', D.other ? 1 : 0)
      } else {
        set('option', D.options.length)
        set('fallback', D.fallback ? D.fallback.options.length : 0)
      }
      break
    case 'text':
      set('field', D.fields.length)
      set('chip', D.chip ? 1 : 0)
      set('suggestion', D.typeahead ? new Set(Object.values(D.typeahead).flat()).size : 0)
      break
    case 'newspaper': set('field', Object.keys(D.labels).length); break
    case 'piles': set('card', D.cards.length); set('pile', D.piles.length); break
    case 'podium': set('option', (D.options || []).length); break
    case 'configure':
      set('item', D.items.length)
      set('part', D.parts.length)
      set('part_option', D.parts.reduce((t, p) => t + p.options.length, 0))
      break
    case 'track': set('stop', D.stops.length); set('end', (D.ends || []).length); break
    case 'trays': set('tray', D.trays.length); set('tile', D.tiles.length); break
    case 'ladder': set('row', D.rows.length); set('column', 2); break
    case 'rank': set('block', D.blocks.length); break
    case 'sentence':
      if (D.rowsFrom) set('role', D.rowsFrom.roles.length)
      else {
        const parts = D.rows.flatMap((r) => r.parts).filter((p) => p && typeof p === 'object')
        set('slot', parts.length)
        set('chip', parts.filter((p) => p.slot === 'chips').reduce((t, p) => t + p.options.length, 0))
        set('opt_out', D.optOut ? 1 : 0)
      }
      break
    case 'stamp': if (D.mode !== 'pick-line') { set('stamp', D.stamps.length); set('card', D.cards.length) } break
    case 'allocate-ledger': set('row', D.rows.length); set('slot', D.split ? 1 : 0); break
    case 'allocate-list': set('row', D.rows.length); break
    case 'bottle': set('jug', D.jugs.length); break
    default: break
  }
  return c
}

/* ======================================================================================= build-time consistency */

const conditional = STEPS.filter((s) => s.previewCondition).map((s) => s.id).sort()
const ruled = Object.keys(CONDITIONS).sort()
if (conditional.join() !== ruled.join()) fail(`conditional steps in script.js (${conditional}) differ from flatten.mjs CONDITIONS (${ruled})`)

const OPTIONS = {}
for (const s of STEPS) {
  const rows = optionRows(s)
  const seen = new Set()
  rows.forEach((r) => {
    if (!OPTION_SETS.includes(r.set)) fail(`${s.id}: option_set '${r.set}' is not in the vocabulary`)
    const key = `${r.set}\u0000${r.id}`
    if (seen.has(key)) fail(`${s.id}: option id '${r.id}' appears twice in set '${r.set}' (the primary key needs it unique)`)
    seen.add(key)
    if (r.id.length > 60) fail(`${s.id}: option id '${r.id}' is longer than 60 characters`)
  })
  OPTIONS[s.id] = rows
  const want = expectedCounts(s)
  const got = {}
  rows.forEach((r) => { got[r.set] = (got[r.set] || 0) + 1 })
  if (JSON.stringify(Object.entries(want).sort()) !== JSON.stringify(Object.entries(got).sort())) {
    fail(`${s.id}: option rows ${JSON.stringify(got)} differ from script.js counts ${JSON.stringify(want)}`)
  }
}

/* ================================================================================ the two sample respondents */

const ANSWERED = STEPS.filter((s) => storesAnswer(s))
if (ANSWERED.length !== 63) fail(`expected 63 steps that save an answer, found ${ANSWERED.length}`)

/* Fixed keys for the samples: random UUIDs generated once and written here, so the build stays deterministic. They are
   not derived from the SID or the name, and real keys must not be either: use gen_random_uuid() or the like. */
const SAMPLES = [
  {
    sid: 'R000001', name: 'Sample Respondent', device: 'laptop', start: Date.UTC(2026, 9, 19, 8, 30, 0),
    respondentId: '1ea8ee4e-09dc-444a-ad2b-4d40d8b42a9a', submissionId: '25171819-dd07-40c1-b058-d149f0d3a157',
    answers: sampleAnswers(script), what: 'sees and answers every question and follow-up',
  },
  {
    sid: 'R000002', name: 'Sample Respondent Two', device: 'phone', start: Date.UTC(2026, 9, 20, 13, 5, 0),
    respondentId: 'f1debc9a-0b47-411b-ab53-497c587beba8', submissionId: '8706edd2-b8c4-47bc-9464-db1eab7901fd',
    answers: secondAnswers(script), what: "sees none of the eleven conditional steps; nothing to place on 5.2; 10.4 left empty",
  },
]

/* Illustrative change of mind on 2.2 for answer_event: lombard went into Core, was undone, then sorted into Critical. */
function events22(final) {
  const keys = Object.keys(final)
  const upTo = (n, patch) => {
    const o = {}
    keys.slice(0, n).forEach((k) => { o[k] = final[k] })
    return Object.assign(o, patch || {})
  }
  const at = keys.indexOf('lombard') + 1
  return [
    { value: upTo(at, { lombard: 'core' }), committed: false },   // lombard sorted into Core
    { value: upTo(at - 1), committed: false },                     // Undo takes it back
    { value: final, committed: true },                              // sorted into Critical, then the rest; Next
  ]
}

/* Each sample, step by step as the rules in data-dictionary.md say: a step that does not show gets a row with
   shown = false and no value, written when the respondent passes it (no time spent); every other step is validated
   (complete), flattened, and saved with a commit (and, on R000001's 2.2, two drafts first). */
for (const sm of SAMPLES) {
  const ctx = { steps: STEPS, answers: sm.answers }
  sm.rows = {}
  let clock = sm.start
  for (const s of STEPS) {
    const dur = Math.round((s.min || 0.1) * 60) * 1000
    if (!storesAnswer(s)) { clock += dur; continue }
    const value = sm.answers[s.id] === undefined ? null : sm.answers[s.id]
    const shown = shows(s, sm.answers, ctx)
    if (shown === null) fail(`${sm.sid} ${s.id}: shows() cannot tell (an answer it needs is missing)`)
    if (!shown) {
      if (value !== null) fail(`${sm.sid} ${s.id}: not shown, so it must have no value`)
      sm.rows[s.id] = { shown: false, value: null, items: [], first: clock, last: clock, revision: 1, events: [] }
      continue
    }
    const v = validate(s, value, ctx)
    if (!v.complete) fail(`${sm.sid} ${s.id}: the sample answer is not complete: ${v.errors.concat(v.incomplete).join('; ')}`)
    const items = flatten(s, value, ctx)
    items.forEach((r) => {
      if (!ATTRIBUTES.includes(r.attribute)) fail(`${s.id}: attribute '${r.attribute}' is not in the list`)
      const ref = refs(s).find((x) => x.attribute === r.attribute)
      if (!ref) fail(`${s.id}: refs() has no entry for attribute '${r.attribute}'`)
      if (!ref.itemSets.some((set) => OPTIONS[ref.itemStep].some((o) => o.set === set && o.id === r.item_id))) {
        fail(`${s.id}: item_id '${r.item_id}' (${r.attribute}) is not an option of ${ref.itemStep} in ${ref.itemSets}`)
      }
    })
    const first = clock + Math.max(3000, Math.round(dur * 0.4 / 1000) * 1000)
    const last = clock + Math.max(5000, Math.round(dur * 0.9 / 1000) * 1000)
    const evs = sm.sid === 'R000001' && s.id === '2.2' ? events22(value) : [{ value, committed: true }]
    const events = evs.map((e, i) => Object.assign(e, { revision: i + 1, at: i === evs.length - 1 ? last : first + i * 4000 }))
    sm.rows[s.id] = { shown: true, value, items, first, last, revision: events.length, events }
    clock += dur
  }
  sm.lastSaved = Math.max(...Object.values(sm.rows).map((r) => r.last))
  sm.submittedAt = sm.rows['10.5'].last + 1000
  sm.notShown = ANSWERED.filter((s) => !sm.rows[s.id].shown).map((s) => s.id)
  sm.noValue = ANSWERED.filter((s) => sm.rows[s.id].shown && sm.rows[s.id].value === null).map((s) => s.id)
}
if (SAMPLES[0].notShown.length || SAMPLES[0].noValue.length) fail('R000001 must see and answer every step')
if (SAMPLES[1].notShown.slice().sort().join() !== Object.keys(CONDITIONS).sort().join()) fail('R000002 must miss exactly the eleven conditional steps')
if (SAMPLES[1].noValue.join() !== '5.2,10.4') fail(`R000002 must have no value on 5.2 and 10.4 only (found ${SAMPLES[1].noValue})`)

const ALL_ROWS = SAMPLES.flatMap((sm) => ANSWERED.map((s) => sm.rows[s.id]))
const TOTALS = {
  answers: ALL_ROWS.length,
  values: ALL_ROWS.filter((r) => r.value !== null).length,
  scalars: ALL_ROWS.filter((r) => r.value !== null && typeof r.value !== 'object').length,
  notShown: ALL_ROWS.filter((r) => !r.shown).length,
  items: ALL_ROWS.reduce((t, r) => t + r.items.length, 0),
  events: ALL_ROWS.reduce((t, r) => t + r.events.length, 0),
  valueRefs: SAMPLES.reduce((t, sm) => t + ANSWERED.reduce((u, s) => u + sm.rows[s.id].items.filter((it) => refs(s).find((r) => r.attribute === it.attribute).valueSet).length, 0), 0),
}

/* ============================================================================================= write 02 and 03 */

const GENERATED = (what) => [
  `-- Ceres questionnaire ${VERSION}: ${what}`,
  '-- GENERATED by tools/build-sql.mjs from questionnaire/v3/script.js. Do not edit: change the script or the tool and rebuild.',
  `-- script.js sha256 ${sha256}`,
]

function insert(table, row) {
  const cols = Object.keys(row)
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => row[c]).join(', ')});`
}

function sql02() {
  const L = GENERATED(`the questionnaire, its ${STEPS.length} steps and every option`)
  L.push('-- Load after 01-schema.sql. Top-3 follow-ups (2.2a, 2.5a, 6.3a, 7.2a) and 8.1a have no options of their own:')
  L.push("-- they offer their parent's cards. SET client_encoding, BEGIN and COMMIT are PostgreSQL forms (see the porting notes).", '')
  L.push("SET client_encoding = 'UTF8';", 'BEGIN;', '')
  L.push(insert('questionnaire', { version: q(VERSION), label: q(LABEL), released: date(RELEASED), script_sha256: q(sha256) }), '')
  L.push('-- Steps, in play order')
  STEPS.forEach((s, i) => {
    const r = stepRow(s, i + 1)
    L.push(insert('step', Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'seq' ? num(v) : k === 'wave1_only' ? bool(v) : q(v)]))))
  })
  L.push('')
  let n = 0
  STEPS.forEach((s) => {
    const rows = OPTIONS[s.id]
    if (!rows.length) return
    L.push(`-- ${s.id}  ${s.title} (${s.template})`)
    rows.forEach((o) => {
      n++
      L.push(insert('step_option', {
        version: q(VERSION), step_id: q(s.id), option_set: q(o.set), option_id: q(o.id), label: q(o.label), hint: q(o.hint),
        grp: q(o.grp), parent_option_id: q(o.parent), seq: num(o.seq), extra_json: json(o.extra),
      }))
    })
  })
  L.push('', 'COMMIT;', `-- ${STEPS.length} steps, ${n} options`, '')
  return { text: L.join('\n'), options: n }
}

function sql03() {
  const L = GENERATED('two sample respondents (SIDs R000001 and R000002), each with a submitted run')
  L.push('-- R000001 sees and answers each of the 63 questions and follow-ups. R000002 sees none of the eleven conditional')
  L.push('-- steps (their rows have shown = false and no value), has nothing to place on 5.2 (5.1\'s split is $10mm: shown,')
  L.push('-- no value) and leaves the optional 10.4 empty. Answers come from each step\'s data.sample in script.js, else from')
  L.push('-- tools/sample-answers.mjs, and all pass validate(). answer_item rows are flatten(step, value, ctx). answer_event has')
  L.push('-- one commit for each row the respondent saw, plus two drafts on R000001\'s 2.2 (lombard sorted into Core, undone,')
  L.push('-- then sorted into Critical) to show a change of mind. Each run is written in progress and then marked submitted,')
  L.push('-- the order the optional trigger in 01 needs. Times follow the planning minutes of each step.')
  L.push('-- SET client_encoding, BEGIN and COMMIT are PostgreSQL forms (see the porting notes).', '')
  L.push("SET client_encoding = 'UTF8';", 'BEGIN;', '')
  for (const sm of SAMPLES) {
    const sub = q(sm.submissionId)
    L.push(`-- ${sm.sid}: ${sm.what}`)
    L.push(insert('respondent', { respondent_id: q(sm.respondentId), sid: q(sm.sid), full_name: q(sm.name), created_at: ts(sm.start - 20000) }))
    L.push(insert('submission', { submission_id: sub, respondent_id: q(sm.respondentId), version: q(VERSION), status: q('in_progress'), started_at: ts(sm.start), device: q(sm.device) }))
    L.push(`-- ${sm.sid}: answer (value_json exactly as the screen saves it; shown = false and no value for a step that did not show)`)
    ANSWERED.forEach((s) => {
      const r = sm.rows[s.id]
      L.push(insert('answer', {
        submission_id: sub, version: q(VERSION), step_id: q(s.id), value_json: json(r.value), shown: bool(r.shown),
        first_saved_at: ts(r.first), saved_at: ts(r.last), revision: num(r.revision),
      }))
    })
    L.push(`-- ${sm.sid}: answer_item, flatten(step, value_json, ctx)`)
    ANSWERED.forEach((s) => sm.rows[s.id].items.forEach((r) => {
      L.push(insert('answer_item', {
        submission_id: sub, step_id: q(s.id), item_id: q(r.item_id), attribute: q(r.attribute),
        value_text: q(r.value_text), value_number: num(r.value_number), seq: num(r.seq),
      }))
    }))
    L.push(`-- ${sm.sid}: answer_event (optional table), every save in the order saved`)
    const evs = []
    ANSWERED.forEach((s) => sm.rows[s.id].events.forEach((ev) => evs.push({ s, ev })))
    evs.sort((a, b) => a.ev.at - b.ev.at || STEPS.indexOf(a.s) - STEPS.indexOf(b.s) || a.ev.revision - b.ev.revision)
    evs.forEach(({ s, ev }) => L.push(insert('answer_event', {
      submission_id: sub, step_id: q(s.id), revision: num(ev.revision), value_json: json(ev.value),
      committed: bool(ev.committed), saved_at: ts(ev.at),
    })))
    L.push(`-- ${sm.sid}: Send on 10.5`)
    L.push(`UPDATE submission SET status = 'submitted', submitted_at = ${ts(sm.submittedAt)}, last_saved_at = ${ts(sm.lastSaved)}, last_step_id = 'end' WHERE submission_id = ${sub};`, '')
  }
  L.push('COMMIT;', `-- ${SAMPLES.length} respondents, ${SAMPLES.length} submitted runs, ${TOTALS.answers} answer rows (${TOTALS.notShown} not shown), ${TOTALS.items} answer_item rows, ${TOTALS.events} answer_event rows`, '')
  return L.join('\n')
}

/* ======================================================================================================= write 05 */

/* The queries of 04, each with its [Qn] marker and title. */
function queries04() {
  const text = readFileSync(path.join(SQL_DIR, '04-analysis-queries.sql'), 'utf8')
  const parts = text.split(/^(?=-- \[Q\d+\])/m).slice(1)
  const noComments = (s) => s.replace(/--[^\n]*/g, '')
  return parts.map((p) => {
    const head = p.match(/^-- \[(Q\d+)\] ([^\n]*)/)
    if (!head) fail('04: a query has no [Qn] marker')
    const end = p.lastIndexOf(';')
    if (end < 0) fail(`04 ${head[1]}: no closing semicolon`)
    const body = p.slice(0, end).trimEnd()
    if (noComments(body).includes(';')) fail(`04 ${head[1]}: one statement per [Qn] block`)
    if (noComments(p.slice(end + 1)).trim()) fail(`04 ${head[1]}: SQL after the closing semicolon`)
    return { id: head[1], title: head[2].trim(), body }
  })
}

function sql05(nOptions) {
  const T = TOTALS
  const R1 = SAMPLES[0]
  const R2 = SAMPLES[1]
  const L = GENERATED('self-checks for this package (PostgreSQL)')
  L.push('-- Run after 01-04 with psql -v ON_ERROR_STOP=1. Each check prints one "ok" line or stops with CHECK FAILED.')
  L.push('-- Tests that write rows run inside a transaction that is rolled back, except section 8, which rebuilds R000002\'s')
  L.push('-- answer_item rows as they were: the database is left as it was. Sections 6 and 8 use the optional trigger of 01')
  L.push('-- (tg_answer_item_submitted); leave those tests out if you drop it.', '')
  L.push('\\pset tuples_only on', '\\pset format unaligned', "SET client_min_messages = 'warning';", '')
  L.push(`CREATE FUNCTION pg_temp.expect(what text, got bigint, want bigint) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'CHECK FAILED: %: got %, expected %', what, got, want; END IF;
  RETURN 'ok  ' || what || ': ' || got;
END $f$;
CREATE FUNCTION pg_temp.expect_text(what text, got text, want text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'CHECK FAILED: %: got %, expected %', what, got, want; END IF;
  RETURN 'ok  ' || what || ': ' || got;
END $f$;
CREATE FUNCTION pg_temp.expect_none(what text, problems text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF problems IS NOT NULL THEN RAISE EXCEPTION 'CHECK FAILED: %: %', what, problems; END IF;
  RETURN 'ok  ' || what;
END $f$;
CREATE FUNCTION pg_temp.expect_rows(what text, got bigint) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF got IS NULL OR got = 0 THEN RAISE EXCEPTION 'CHECK FAILED: % returned no rows', what; END IF;
  RETURN 'ok  ' || what || ': ' || got || ' rows';
END $f$;
-- runs a statement that must fail on a constraint or the optional trigger; its effects are undone either way
CREATE FUNCTION pg_temp.rejects(what text, stmt text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION
    WHEN integrity_constraint_violation OR string_data_right_truncation OR invalid_text_representation THEN
      RETURN 'ok  rejected: ' || what || ' (' || SQLSTATE || ')';
  END;
  RAISE EXCEPTION 'CHECK FAILED: accepted %', what;
END $f$;
`)
  const E = (what, got, want) => L.push(`SELECT pg_temp.expect(${q(what)}, ${got}, ${want});`)
  const ET = (what, got, want) => L.push(`SELECT pg_temp.expect_text(${q(what)}, ${got}, ${q(want)});`)
  const R = (what, stmt) => L.push(`SELECT pg_temp.rejects(${q(what)}, ${q(stmt)});`)
  const QS = Object.fromEntries(queries04().map((Q) => [Q.id, Q]))
  const fromQ = (id, expr, where) => `(SELECT ${expr} FROM (\n${QS[id].body}\n) AS q${where ? ` WHERE ${where}` : ''})`
  const runOf = (sid) => `(SELECT s.submission_id FROM submission s JOIN respondent r ON r.respondent_id = s.respondent_id WHERE r.sid = '${sid}')`
  const V = `'${VERSION}'`

  L.push('-- 1. The questionnaire')
  ET(`questionnaire ${VERSION} matches script.js (sha256)`, `(SELECT script_sha256 FROM questionnaire WHERE version = ${V})`, sha256)
  const k = (kind) => STEPS.filter((s) => s.kind === kind).length
  E('steps in all', `(SELECT count(*) FROM step WHERE version = ${V})`, STEPS.length)
  E('questions', `(SELECT count(*) FROM step WHERE version = ${V} AND kind = 'question')`, k('question'))
  E('follow-ups', `(SELECT count(*) FROM step WHERE version = ${V} AND kind = 'followup')`, k('followup'))
  E('chapter breaks', `(SELECT count(*) FROM step WHERE version = ${V} AND kind = 'break')`, k('break'))
  E('conditional steps (show_condition set)', `(SELECT count(*) FROM step WHERE version = ${V} AND show_condition IS NOT NULL)`, conditional.length)
  E('wave-1-only steps', `(SELECT count(*) FROM step WHERE version = ${V} AND wave1_only)`, STEPS.filter((s) => s.sensitive).length)
  E('options in all', `(SELECT count(*) FROM step_option WHERE version = ${V})`, nOptions)
  L.push('')

  L.push('-- 2. Option counts per step and set, read from script.js')
  L.push('CREATE TEMP TABLE expected_option_count (step_id varchar(20), option_set varchar(20), n integer);')
  const counts = []
  STEPS.forEach((s) => Object.entries(expectedCounts(s)).forEach(([set, n]) => counts.push(`(${q(s.id)}, ${q(set)}, ${n})`)))
  for (let i = 0; i < counts.length; i += 8) L.push(`INSERT INTO expected_option_count VALUES ${counts.slice(i, i + 8).join(', ')};`)
  L.push(`SELECT pg_temp.expect_none('option counts per step and set match script.js (${counts.length} step-set pairs)', (
  SELECT string_agg(coalesce(e.step_id, a.step_id) || ' ' || coalesce(e.option_set, a.option_set) || ': expected '
         || coalesce(e.n, 0) || ', found ' || coalesce(a.n, 0), '; ')
  FROM expected_option_count e
  FULL JOIN (SELECT step_id, option_set, count(*)::int AS n FROM step_option WHERE version = ${V} GROUP BY step_id, option_set) a
    ON a.step_id = e.step_id AND a.option_set = e.option_set
  WHERE e.n IS DISTINCT FROM a.n));`)
  const spot = [['2.2', 'card', 15], ['2.2', 'pile', 4], ['2.4a', 'option', 6], ['8.3', 'card', 5], ['2.5', 'card', 12],
    ['3.2', 'option', 10], ['9.1', 'block', 10], ['2.3', 'part_option', 20], ['7.1', 'stop', 11], ['9.4b', 'market', 18],
    ['5.4a', 'row', 9], ['8.1', 'card', 12], ['2.6', 'tile', 6], ['4.3a', 'role', 5]]
  spot.forEach(([id, set, n]) => E(`${id}: step_option rows in set ${set}`, `(SELECT count(*) FROM step_option WHERE version = ${V} AND step_id = '${id}' AND option_set = '${set}')`, n))
  E("options of the top-3 follow-ups and 8.1a (they use their parent's cards)", `(SELECT count(*) FROM step_option WHERE version = ${V} AND step_id IN ('2.2a', '2.5a', '6.3a', '7.2a', '8.1a'))`, 0)
  L.push('')

  L.push('-- 3. The two sample respondents')
  for (const sm of SAMPLES) {
    const run = runOf(sm.sid)
    E(`${sm.sid}: submitted runs`, `(SELECT count(*) FROM submission s JOIN respondent r ON r.respondent_id = s.respondent_id WHERE r.sid = '${sm.sid}' AND s.status = 'submitted')`, 1)
    E(`${sm.sid}: answer rows (one per step that saves an answer)`, `(SELECT count(*) FROM answer WHERE submission_id = ${run})`, ANSWERED.length)
    E(`${sm.sid}: rows shown, with a value`, `(SELECT count(*) FROM answer WHERE submission_id = ${run} AND shown AND value_json IS NOT NULL)`, ANSWERED.length - sm.notShown.length - sm.noValue.length)
    E(`${sm.sid}: rows not shown`, `(SELECT count(*) FROM answer WHERE submission_id = ${run} AND NOT shown)`, sm.notShown.length)
  }
  const agg = (cond) => `(SELECT string_agg(a.step_id, ' ' ORDER BY st.seq) FROM answer a JOIN step st ON st.version = a.version AND st.step_id = a.step_id WHERE a.submission_id = ${runOf('R000002')} AND ${cond})`
  ET('R000002: the rows not shown (every conditional step)', agg('NOT a.shown'), R2.notShown.join(' '))
  ET('R000002: rows shown without a value (5.2 nothing to place, 10.4 left empty)', agg('a.shown AND a.value_json IS NULL'), R2.noValue.join(' '))
  E('answers to steps that save nothing', `(SELECT count(*) FROM answer a JOIN step st ON st.version = a.version AND st.step_id = a.step_id WHERE st.template IN ('flow', 'break'))`, 0)
  E('answer_item rows on answers not shown', '(SELECT count(*) FROM answer_item ai JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id WHERE NOT a.shown)', 0)
  E('value_json that is not JSON', '(SELECT count(*) FROM answer WHERE value_json IS NOT NULL AND NOT (value_json IS JSON))', 0)
  E('value_json that parses with a cast to json', '(SELECT count(*) FROM answer WHERE value_json IS NOT NULL AND (value_json::json) IS NOT NULL)', T.values)
  E('scalar answers, a bare string or number (valid JSON and valid answers)', "(SELECT count(*) FROM answer WHERE value_json IS NOT NULL AND json_typeof(value_json::json) IN ('string', 'number'))", T.scalars)
  E('answer_event value_json that is not JSON', '(SELECT count(*) FROM answer_event WHERE value_json IS NOT NULL AND NOT (value_json IS JSON))', 0)
  E('answer_item rows (flatten of every value)', '(SELECT count(*) FROM answer_item)', T.items)
  E('answer_event rows', '(SELECT count(*) FROM answer_event)', T.events)
  L.push('')

  L.push('-- 4. Every answer_item points at real options: item_id at an option of the step (or of its parent), and value_text,')
  L.push('--    where it names a pile, stamp, tray, word or 2.3 option, at an option of the step. (refs() in tools/flatten.mjs.)')
  L.push('CREATE TEMP TABLE item_ref (step_id varchar(20), attribute varchar(20), item_step_id varchar(20), item_set varchar(20));')
  L.push('CREATE TEMP TABLE value_ref (step_id varchar(20), attribute varchar(20), value_set varchar(20), value_parent varchar(10));')
  const ir = []
  const vr = []
  STEPS.forEach((s) => refs(s).forEach((r) => {
    r.itemSets.forEach((set) => ir.push(`(${q(s.id)}, ${q(r.attribute)}, ${q(r.itemStep)}, ${q(set)})`))
    if (r.valueSet) vr.push(`(${q(s.id)}, ${q(r.attribute)}, ${q(r.valueSet)}, ${q(r.valueParent)})`)
  }))
  for (let i = 0; i < ir.length; i += 6) L.push(`INSERT INTO item_ref VALUES ${ir.slice(i, i + 6).join(', ')};`)
  for (let i = 0; i < vr.length; i += 6) L.push(`INSERT INTO value_ref VALUES ${vr.slice(i, i + 6).join(', ')};`)
  E('answer_item rows whose item_id is an option of the step or its parent', `(
  SELECT count(*) FROM answer_item ai JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id
  WHERE EXISTS (SELECT 1 FROM item_ref r JOIN step_option o ON o.version = a.version AND o.step_id = r.item_step_id
                  AND o.option_set = r.item_set AND o.option_id = ai.item_id
                WHERE r.step_id = ai.step_id AND r.attribute = ai.attribute))`, T.items)
  E('answer_item rows whose value_text should name an option', '(SELECT count(*) FROM answer_item ai JOIN value_ref r ON r.step_id = ai.step_id AND r.attribute = ai.attribute)', T.valueRefs)
  E('... of which name an option of the step', `(
  SELECT count(*) FROM answer_item ai JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id
  JOIN value_ref r ON r.step_id = ai.step_id AND r.attribute = ai.attribute
  WHERE EXISTS (SELECT 1 FROM step_option o WHERE o.version = a.version AND o.step_id = ai.step_id AND o.option_set = r.value_set
                  AND o.option_id = ai.value_text
                  AND (r.value_parent IS NULL OR o.parent_option_id = CASE r.value_parent WHEN 'attribute' THEN ai.attribute ELSE ai.item_id END)))`, T.valueRefs)
  L.push('')

  L.push('-- 5. The rules the screens enforce hold in the stored answers')
  L.push(`SELECT pg_temp.expect('card-sort rows equal to value_json read in key order (json_each WITH ORDINALITY)', (
  SELECT count(*) FROM answer a
  CROSS JOIN LATERAL json_each_text(a.value_json::json) WITH ORDINALITY AS j(card, pile, ord)
  JOIN answer_item ai ON ai.submission_id = a.submission_id AND ai.step_id = a.step_id AND ai.attribute = 'pile'
   AND ai.item_id = j.card AND ai.value_text = j.pile AND ai.seq = j.ord
  WHERE a.step_id IN ('2.2', '2.5', '6.3', '7.2')),
  (SELECT count(*) FROM answer_item WHERE step_id IN ('2.2', '2.5', '6.3', '7.2') AND attribute = 'pile'));`)
  E("top-3 picks outside the parent's Critical pile", `(
  SELECT count(*) FROM answer_item ai
  JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id
  JOIN step st ON st.version = a.version AND st.step_id = ai.step_id
  WHERE st.template = 'podium' AND st.parent_step_id IS NOT NULL AND ai.attribute = 'rank'
    AND NOT EXISTS (SELECT 1 FROM answer_item p WHERE p.submission_id = ai.submission_id AND p.step_id = st.parent_step_id
                      AND p.attribute = 'pile' AND p.item_id = ai.item_id AND p.value_text = 'critical'))`, 0)
  E('2.3 products covered that were put in Not for HNW on 2.2', `(
  SELECT count(*) FROM answer_item c JOIN answer_item p ON p.submission_id = c.submission_id AND p.step_id = '2.2'
    AND p.attribute = 'pile' AND p.item_id = c.value_text AND p.value_text = 'not-hnw'
  WHERE c.step_id = '2.3' AND c.attribute = 'covers')`, 0)
  E('5.4a answers whose shares do not add up to 100', "(SELECT count(*) FROM (SELECT submission_id FROM answer_item WHERE step_id = '5.4a' AND attribute = 'percent' GROUP BY submission_id HAVING sum(value_number) <> 100) x)", 0)
  E('5.1 answers whose rows do not add up to the split (and no rows while the split is 0)', `(
  SELECT count(*) FROM (SELECT submission_id FROM answer_item WHERE step_id = '5.1' GROUP BY submission_id
    HAVING sum(CASE WHEN item_id = 'split' THEN value_number ELSE 0 END) <> sum(CASE WHEN item_id <> 'split' THEN value_number ELSE 0 END)
        OR (max(CASE WHEN item_id = 'split' THEN value_number END) = 0 AND count(CASE WHEN item_id <> 'split' THEN 1 END) > 0)) x)`, 0)
  E('5.2 answers that do not add up to $10mm less the 5.1 split (and no rows when the split is 10)', `(
  SELECT count(*) FROM answer a
  JOIN answer_item s ON s.submission_id = a.submission_id AND s.step_id = '5.1' AND s.item_id = 'split'
  LEFT JOIN (SELECT submission_id, sum(value_number) AS total, count(*) AS n FROM answer_item WHERE step_id = '5.2' GROUP BY submission_id) i
    ON i.submission_id = a.submission_id
  WHERE a.step_id = '5.2' AND a.shown
    AND ((s.value_number = 10 AND COALESCE(i.n, 0) > 0) OR (s.value_number < 10 AND COALESCE(i.total, 0) <> 10 - s.value_number)))`, 0)
  E('5.2 rows of runs whose split is 10: shown, with no value', "(SELECT count(*) FROM answer a JOIN answer_item s ON s.submission_id = a.submission_id AND s.step_id = '5.1' AND s.item_id = 'split' AND s.value_number = 10 WHERE a.step_id = '5.2' AND a.shown AND a.value_json IS NULL)", SAMPLES.filter((sm) => sm.answers['5.1'].split === 10).length)
  E('6.4 answers that do not place exactly 10 bankers', "(SELECT count(*) FROM (SELECT submission_id FROM answer_item WHERE step_id = '6.4' GROUP BY submission_id HAVING sum(value_number) <> 10) x)", 0)
  E('9.1 answers that do not rank all 10 blocks', "(SELECT count(*) FROM (SELECT submission_id FROM answer_item WHERE step_id = '9.1' GROUP BY submission_id HAVING count(*) <> 10 OR max(value_number) <> 10) x)", 0)
  E('10.3 chip rows (R000002 tapped No one does it well)', "(SELECT count(*) FROM answer_item WHERE step_id = '10.3' AND attribute = 'chip' AND item_id = 'name' AND value_text = 'no one')", SAMPLES.filter((sm) => sm.answers['10.3'] && sm.answers['10.3'].name === 'no one').length)
  E('answers whose latest answer_event differs from the answer', `(
  SELECT count(*) FROM answer a
  JOIN LATERAL (SELECT e.revision, e.value_json FROM answer_event e WHERE e.submission_id = a.submission_id AND e.step_id = a.step_id
                ORDER BY e.revision DESC LIMIT 1) e ON true
  WHERE e.revision <> a.revision OR e.value_json IS DISTINCT FROM a.value_json)`, 0)
  L.push('')

  const TR = '00000000-0000-4000-8000-000000000002'   // a test respondent and run, rolled back
  const TS = '00000000-0000-4000-8000-0000000000a2'
  const R1RUN = `'${R1.submissionId}'`
  const R2RUN = `'${R2.submissionId}'`
  L.push('-- 6. Constraints, the save rules, the optional trigger, the a.shown safeguard of 04, and removing an identity.')
  L.push('--    Everything in this section is rolled back.')
  L.push('BEGIN;')
  L.push('-- identity')
  R('a lower-case SID', "INSERT INTO respondent (sid, full_name) VALUES ('r123456', 'Test Person')")
  R('a SID with a space in it', "INSERT INTO respondent (sid, full_name) VALUES ('R12 3456', 'Test Person')")
  R('a SID with leading spaces', "INSERT INTO respondent (sid, full_name) VALUES ('  R123456', 'Test Person')")
  R('an empty SID', "INSERT INTO respondent (sid, full_name) VALUES ('', 'Test Person')")
  R('a SID of 21 characters', "INSERT INTO respondent (sid, full_name) VALUES ('R12345678901234567890', 'Test Person')")
  R('a second respondent with SID R000001', "INSERT INTO respondent (sid, full_name) VALUES ('R000001', 'Someone Else')")
  R('a name with a leading space', "INSERT INTO respondent (sid, full_name) VALUES ('R123456', ' Test Person')")
  R('a name with a trailing newline', "INSERT INTO respondent (sid, full_name) VALUES ('R123456', E'Test Person\\n')")
  R('an empty name', "INSERT INTO respondent (sid, full_name) VALUES ('R123456', '')")
  L.push('-- runs: one per person, ever, and a new run always has a respondent')
  R('a second run for R000001 under the same version', `INSERT INTO submission (respondent_id, version) SELECT respondent_id, ${V} FROM respondent WHERE sid = 'R000001'`)
  L.push(`INSERT INTO questionnaire (version, label, released, script_sha256) VALUES ('v9-test', 'A later version, for this test only', DATE '2026-12-01', '${'0'.repeat(64)}');`)
  R('a second run for R000001 under a later version', "INSERT INTO submission (respondent_id, version) SELECT respondent_id, 'v9-test' FROM respondent WHERE sid = 'R000001'")
  R('a new run with no respondent', `INSERT INTO submission (version) VALUES (${V})`)
  R('a new run with no respondent and identity_removed_at already set', `INSERT INTO submission (version, identity_removed_at) VALUES (${V}, CURRENT_TIMESTAMP)`)
  L.push('-- a test respondent (X1234567) with no run yet: the refused inserts below create none')
  L.push(`INSERT INTO respondent (respondent_id, sid, full_name) VALUES ('${TR}', 'X1234567', 'Test Person');`)
  R('a new run for a respondent with identity_removed_at already set', `INSERT INTO submission (respondent_id, version, identity_removed_at) VALUES ('${TR}', ${V}, CURRENT_TIMESTAMP)`)
  R('status submitted without submitted_at', `INSERT INTO submission (respondent_id, version, status) VALUES ('${TR}', ${V}, 'submitted')`)
  R('a device other than laptop, phone or tablet', `INSERT INTO submission (respondent_id, version, device) VALUES ('${TR}', ${V}, 'desktop')`)
  L.push('-- the test respondent\'s in-progress run, for the answer-level checks')
  L.push(`INSERT INTO submission (submission_id, respondent_id, version, device, last_step_id) VALUES ('${TS}', '${TR}', ${V}, 'phone', '2.2');`)
  L.push(`INSERT INTO answer (submission_id, version, step_id, value_json) VALUES ('${TS}', ${V}, '1.1', '"advice"');`)
  R('an answer to a step v3 does not have', `INSERT INTO answer (submission_id, version, step_id, value_json) VALUES ('${TS}', ${V}, '99.9', '"x"')`)
  R('a second answer row for the same step', `INSERT INTO answer (submission_id, version, step_id, value_json) VALUES ('${TS}', ${V}, '1.1', '"goals"')`)
  R('value_json that is not JSON', `INSERT INTO answer (submission_id, version, step_id, value_json) VALUES ('${TS}', ${V}, '1.2', '{not json')`)
  R('a value on a row marked not shown', `INSERT INTO answer (submission_id, version, step_id, value_json, shown) VALUES ('${TS}', ${V}, '1.3', '"name"', false)`)
  R('an answer_item attribute outside the list', `INSERT INTO answer_item (submission_id, step_id, item_id, attribute, seq) VALUES ('${TS}', '1.1', 'advice', 'colour', 1)`)
  R('an answer_item with no answer row', `INSERT INTO answer_item (submission_id, step_id, item_id, attribute, seq) VALUES ('${TS}', '1.4', 'banker', 'choice', 1)`)
  R('an option_set outside the vocabulary', `INSERT INTO step_option (version, step_id, option_set, option_id, seq) VALUES (${V}, '1.1', 'colour', 'red', 1)`)
  R('a follow-up step without a parent', `INSERT INTO step (version, step_id, seq, kind, template, title) VALUES (${V}, 'x.1a', 999, 'followup', 'checklist', 'Test')`)
  L.push("-- 2.2a passed without showing (three cards in Critical), then 2.2 changed so that it shows, and it is answered")
  L.push(`INSERT INTO answer (submission_id, version, step_id, value_json, shown) VALUES ('${TS}', ${V}, '2.2a', NULL, false);`)
  E('a step passed without showing: shown = false, no value', `(SELECT count(*) FROM answer WHERE submission_id = '${TS}' AND step_id = '2.2a' AND NOT shown AND value_json IS NULL)`, 1)
  R('storing a value on it without setting shown = true', `UPDATE answer SET value_json = '["securities","lombard","alternatives"]', revision = revision + 1 WHERE submission_id = '${TS}' AND step_id = '2.2a'`)
  L.push('-- the save of data-dictionary.md ("Every save"): storing a value always sets shown = true')
  L.push(`INSERT INTO answer (submission_id, version, step_id, value_json, shown, first_saved_at, saved_at, revision)
VALUES ('${TS}', ${V}, '2.2a', '["securities","lombard","alternatives"]', true, now(), now(), 1)
ON CONFLICT (submission_id, step_id) DO UPDATE
  SET value_json = EXCLUDED.value_json, shown = true, revision = answer.revision + 1,
      saved_at = GREATEST(answer.first_saved_at, EXCLUDED.saved_at);`)
  ET('the upsert stores the value and flips shown to true', `(SELECT shown || ' ' || revision || ' ' || value_json FROM answer WHERE submission_id = '${TS}' AND step_id = '2.2a')`, 'true 2 ["securities","lombard","alternatives"]')
  L.push('-- the optional trigger: a submitted run cannot change')
  R('a change to an answer of a submitted run', `UPDATE answer SET revision = revision + 1 WHERE submission_id = ${R1RUN} AND step_id = '1.1'`)
  R('a new answer row on a submitted run', `INSERT INTO answer (submission_id, version, step_id, value_json) VALUES (${R1RUN}, ${V}, 'W', NULL)`)
  R('a new answer_item row on a submitted run', `INSERT INTO answer_item (submission_id, step_id, item_id, attribute, seq) VALUES (${R1RUN}, '1.1', 'advice', 'choice', 2)`)
  R('a new answer_event row on a submitted run', `INSERT INTO answer_event (submission_id, step_id, revision, value_json, committed) VALUES (${R1RUN}, '1.1', 9, '"advice"', true)`)
  L.push("-- rows left behind on R000002's answers that did not show (an application bug): 04 must not count them")
  L.push('ALTER TABLE answer_item DISABLE TRIGGER tg_answer_item_submitted;')
  L.push(`INSERT INTO answer_item (submission_id, step_id, item_id, attribute, value_number, seq) VALUES (${R2RUN}, '2.2a', 'securities', 'rank', 1, 1), (${R2RUN}, '2.4', 'bespoke', 'stop', 5, 1);`)
  L.push('ALTER TABLE answer_item ENABLE TRIGGER tg_answer_item_submitted;')
  E("04 [Q2] ignores them: Shares and bonds placed 1st on 2.2a once (R000001's podium)", fromQ('Q2', 'n_first', "step_id = '2.2a' AND card = 'Shares and bonds'"), 1)
  E('04 [Q4] ignores them: Fully bespoke on 2.4 still 0', fromQ('Q4', 'respondents', "step_id = '2.4' AND label = 'Fully bespoke'"), 0)
  ET('04 [Q5] ignores them: mean position on 2.4 still 3.00', fromQ('Q5', 'mean_position::text'), '3.00')
  E('04 [Q11] ignores them: runs with a 2.2a pick', fromQ('Q11', 'count(*)', 'q2_2a_first IS NOT NULL'), 1)
  E('04 [Q11] ignores them: runs with a 2.4 position', fromQ('Q11', 'count(*)', 'q2_4_position IS NOT NULL'), 1)
  L.push('-- removing an identity')
  R('deleting R000001 before setting identity_removed_at', "DELETE FROM respondent WHERE sid = 'R000001'")
  L.push("UPDATE submission SET identity_removed_at = now() WHERE respondent_id = (SELECT respondent_id FROM respondent WHERE sid = 'R000001');")
  L.push("DELETE FROM respondent WHERE sid = 'R000001';")
  E('after removing R000001: respondent rows for R000001', "(SELECT count(*) FROM respondent WHERE sid = 'R000001')", 0)
  E('after removing R000001: runs with no respondent, identity_removed_at set', '(SELECT count(*) FROM submission WHERE respondent_id IS NULL AND identity_removed_at IS NOT NULL)', 1)
  E('after removing R000001: its answers kept', `(SELECT count(*) FROM answer WHERE submission_id = ${R1RUN})`, ANSWERED.length)
  L.push('ROLLBACK;')
  E('after the rollback: R000001 is back', "(SELECT count(*) FROM respondent WHERE sid = 'R000001')", 1)
  L.push('')

  L.push('-- 7. Every query in 04-analysis-queries.sql runs and returns rows; the cases R000002 exercises give the right values')
  queries04().forEach((Q) => {
    L.push(`SELECT pg_temp.expect_rows(${q(`04 [${Q.id}] ${Q.title.slice(0, 80)}`)}, (SELECT count(*) FROM (\n${Q.body}\n) AS q));`)
  })
  E("04 [Q3] Shares and bonds in the top 3 of both runs (picked on R000001's podium, implied by R000002's Critical pile)", fromQ('Q3', 'in_top3', "step_id = '2.2' AND card = 'Shares and bonds'"), 2)
  E('04 [Q3] Our core offerings: in the top 3 without a podium once (R000002)', fromQ('Q3', 'critical_without_podium', "step_id = '2.2' AND card = 'Our core offerings'"), 1)
  E('04 [Q3] 6.3 with exactly three cards in Critical: High EQ in the top 3 of both runs', fromQ('Q3', 'in_top3', "step_id = '6.3' AND card = 'High EQ'"), 2)
  E('04 [Q5] runs that saw 2.4', fromQ('Q5', 'saw_2_4'), 1)
  E('04 [Q5] runs that did not see 2.4', fromQ('Q5', 'did_not_see_2_4'), 1)
  E('04 [Q18] 7.1 is one row', fromQ('Q18', 'count(*)', "step_id = '7.1'"), 1)
  E('04 [Q18] 7.1 answered by both runs', fromQ('Q18', 'n', "step_id = '7.1'"), 2)
  ET('04 [Q18] 7.1 mean of 60 and 30', fromQ('Q18', 'mean::text', "step_id = '7.1'"), '45.00')
  ET('04 [Q19] J.P. Morgan: mean cash / investments / share of $10mm over both runs', fromQ('Q19', "mean_cash_mm || ' / ' || mean_investments_mm || ' / ' || mean_share_of_10mm_pct", "holder = 'J.P. Morgan'"), '1.50 / 1.50 / 30.0')
  ET("04 [Q19] the holders' means add up to $10mm (one denominator)", fromQ('Q19', 'sum(mean_cash_mm + mean_investments_mm)::text'), '10.00')
  E('04 [Q11] one row per submitted run', fromQ('Q11', 'count(*)'), SAMPLES.length)
  ET("04 [Q11] R000002's 4.2 is Never", fromQ('Q11', 'q4_2_verb', `submission_id = ${R2RUN}`), 'never')
  ET("04 [Q11] R000002's 9.4b market, typed as Another market", fromQ('Q11', 'q9_4b_market', `submission_id = ${R2RUN}`), 'Kenya')
  L.push('')

  const R2ITEMS = ANSWERED.reduce((t, s) => t + R2.rows[s.id].items.length, 0)
  const COLS = 'submission_id, step_id, item_id, attribute, value_text, value_number, seq'
  L.push('-- 8. Rebuilding answer_item for a submitted run, as data-dictionary.md ("Rebuilding answer_item") describes, and')
  L.push("--    committed. The rows written back stand for flatten()'s output; verify.mjs runs the same rebuild with flatten().")
  L.push('BEGIN;')
  E('rebuild: the run is locked', `(SELECT count(*) FROM (SELECT 1 FROM submission WHERE submission_id = ${R2RUN} FOR UPDATE) x)`, 1)
  L.push('LOCK TABLE answer_item IN EXCLUSIVE MODE;')
  L.push('ALTER TABLE answer_item DISABLE TRIGGER tg_answer_item_submitted;')
  L.push(`CREATE TEMP TABLE rebuilt_rows ON COMMIT DROP AS SELECT ${COLS} FROM answer_item WHERE submission_id = ${R2RUN};`)
  L.push(`DELETE FROM answer_item WHERE submission_id = ${R2RUN};`)
  L.push(`INSERT INTO answer_item (${COLS}) SELECT ${COLS} FROM rebuilt_rows;`)
  L.push('ALTER TABLE answer_item ENABLE TRIGGER tg_answer_item_submitted;')
  L.push('COMMIT;')
  E("after the rebuild: R000002's answer_item rows", `(SELECT count(*) FROM answer_item WHERE submission_id = ${R2RUN})`, R2ITEMS)
  ET('after the rebuild: tg_answer_item_submitted is enabled', "(SELECT tgenabled::text FROM pg_trigger WHERE tgname = 'tg_answer_item_submitted')", 'O')
  R('after the rebuild: a new answer_item row on the submitted run', `INSERT INTO answer_item (submission_id, step_id, item_id, attribute, seq) VALUES (${R2RUN}, '1.1', 'advice', 'choice', 2)`)
  L.push('-- a rebuild that fails part-way is undone whole: the rows and the trigger are as they were')
  L.push(`DO $rebuild$
BEGIN
  BEGIN
    ALTER TABLE answer_item DISABLE TRIGGER tg_answer_item_submitted;
    DELETE FROM answer_item WHERE submission_id = ${R2RUN};
    INSERT INTO answer_item (submission_id, step_id, item_id, attribute, seq) VALUES (${R2RUN}, '1.1', 'advice', 'colour', 1);
    RAISE EXCEPTION 'CHECK FAILED: the broken rebuild was not refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $rebuild$;`)
  E("after a failed rebuild: R000002's answer_item rows", `(SELECT count(*) FROM answer_item WHERE submission_id = ${R2RUN})`, R2ITEMS)
  ET('after a failed rebuild: tg_answer_item_submitted is enabled', "(SELECT tgenabled::text FROM pg_trigger WHERE tgname = 'tg_answer_item_submitted')", 'O')
  L.push('')
  L.push("SELECT 'all checks passed';", '')
  return L.join('\n')
}

/* ========================================================================================== data-dictionary.md */

const SET_MEANING = {
  option: 'A choice in a list: tap one, pick one or two, a trade-off pair (1.1-1.4); 3.2\'s own ten podium options',
  fallback: '8.2a\'s fallback question\'s options, for use only if Comp 2.0 may not be named (not live in v3)',
  region: '9.4b: a region (Asia; Europe, Middle East and Africa; Latin America)',
  market: '9.4b: a listed market. option_id is the market name as saved; parent_option_id is its region',
  other: '9.4b: Another market, whose name the respondent types',
  field: 'A text field: 2.1, 10.1-10.4 (label = the stem above the box) and 10.5 (headline, quote). extra_json has the limit',
  chip: 'A word chip: 4.2\'s verb (parent_option_id = the slot, verb); 10.3\'s "No one does it well", whose option_id is the text it writes into the name field ("no one")',
  suggestion: '10.3: a competitor name the type-ahead suggests (extra_json lists the regions it is suggested in)',
  card: 'A card: of a card sort (2.2, 2.5, 6.3, 7.2) or a stamp deck (4.3, 7.4, 8.1, 8.3, 9.2)',
  pile: 'A pile of a card sort: not-hnw, nice, core, critical (hint = the pile\'s gloss)',
  item: '2.3: a way of investing (execute, engage, entrust)',
  part: '2.3: one of the three parts answered for each way of investing (belongs, covers, who)',
  part_option: '2.3: an option of a part; parent_option_id is the part. extra_json "only" limits a who option to some items',
  stop: 'A stop on a track (a scale); seq is its position from the left',
  end: 'The words at either end of a track (2.4, 7.1): first and last. A label, not a choice',
  tray: 'A tray of 2.6 or 5.3',
  tile: 'A tile to put in a tray. 2.6\'s business-banking tile is always offered (extra_json "always")',
  row: 'A row: of 3.1\'s ladder, 5.1-5.2\'s ledger, 5.4a\'s list',
  column: '3.1: the share set on the column, base (today\'s offer) and four (the first four rows together)',
  block: 'A block to rank (3.3, 9.1)',
  slot: 'A blank in a sentence: a number box or a word-chip group, and 5.1\'s split. label = the sentence, slots in brackets; extra_json has the range',
  opt_out: '4.2\'s "Never", saved instead of the sentence',
  role: '4.3a: a role (one of 4.3\'s role cards) that can get its own amount; extra_json has the range',
  stamp: 'A stamp of a stamp deck; extra_json has its impression (the word it prints) and glyph',
  jug: '6.4: a seniority jug (md, ed, vp, associate)',
}

function readSchema() {
  const text = readFileSync(path.join(SQL_DIR, '01-schema.sql'), 'utf8')
  const tables = []
  const re = /CREATE TABLE (\w+) \(\n([\s\S]*?)\n\);/g
  let m
  while ((m = re.exec(text))) {
    const cols = []
    const cons = []
    m[2].split('\n').forEach((line) => {
      const t = line.trim()
      if (!t) return
      if (t.startsWith('CONSTRAINT ')) cons.push(t)
      else if (cons.length) cons[cons.length - 1] += ' ' + t   // a constraint carried over to the next line
      else cols.push({ name: t.split(/\s+/)[0], type: t.replace(/,$/, '').replace(/^\w+\s+/, '').replace(/\s+/g, ' ') })
    })
    tables.push({ name: m[1], cols, cons: cons.map((c) => c.replace(/,$/, '')) })
  }
  const unq = (s) => s.replace(/''/g, "'")
  const tableComments = {}
  const colComments = {}
  for (const c of text.matchAll(/COMMENT ON TABLE (\w+) IS '((?:[^']|'')*)';/g)) tableComments[c[1]] = unq(c[2])
  for (const c of text.matchAll(/COMMENT ON COLUMN (\w+)\.(\w+) IS '((?:[^']|'')*)';/g)) colComments[`${c[1]}.${c[2]}`] = unq(c[3])
  tables.forEach((t) => t.cols.forEach((c) => { if (!colComments[`${t.name}.${c.name}`]) fail(`01: no comment on ${t.name}.${c.name}`) }))
  // indexes and (optional) triggers, listed under their table
  tables.forEach((t) => { t.indexes = []; t.triggers = [] })
  const tbl = (name) => tables.find((t) => t.name === name)
  for (const m of text.matchAll(/CREATE (UNIQUE )?INDEX (\w+) ON (\w+) (\([^;]*?\))( WHERE [^;]+)?;/g)) {
    if (tbl(m[3])) tbl(m[3]).indexes.push(`${m[2]} ${m[1] ? 'UNIQUE ' : ''}${m[4]}${m[5] || ''}`)
  }
  const fnComments = {}
  for (const c of text.matchAll(/COMMENT ON FUNCTION (\w+)\(\) IS '((?:[^']|'')*)';/g)) fnComments[c[1]] = unq(c[2])
  for (const m of text.matchAll(/CREATE TRIGGER (\w+) (BEFORE|AFTER) ([A-Z ]+?) ON (\w+)\s+FOR EACH ROW EXECUTE FUNCTION (\w+)\(\)/g)) {
    if (!fnComments[m[5]]) fail(`01: no comment on function ${m[5]}`)
    if (tbl(m[4])) tbl(m[4]).triggers.push({ text: `${m[1]} ${m[2]} ${m[3]}, ${m[5]}()`, comment: fnComments[m[5]] })
  }
  return { tables, tableComments, colComments }
}

const md = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const code = (s) => '`' + String(s).replace(/`/g, "'") + '`'

function tablesSection() {
  const { tables, tableComments, colComments } = readSchema()
  const out = []
  tables.forEach((t) => {
    out.push(`### ${t.name}`, '', tableComments[t.name] || '', '')
    out.push('| Column | Type | Meaning |', '|---|---|---|')
    t.cols.forEach((c) => out.push(`| ${code(c.name)} | ${md(c.type)} | ${md(colComments[`${t.name}.${c.name}`])} |`))
    out.push('', 'Keys and checks: ' + t.cons.map((c) => code(c.replace(/^CONSTRAINT /, '').replace(/\s+/g, ' '))).join('; ') + '.')
    if (t.indexes.length) out.push('', 'Indexes: ' + t.indexes.map(code).join('; ') + '.')
    t.triggers.forEach((tg) => out.push('', `Trigger ${code(tg.text)}: ${tg.comment}`))
    out.push('')
  })
  return out.join('\n')
}

function setsSection() {
  const used = {}
  STEPS.forEach((s) => OPTIONS[s.id].forEach((o) => {
    used[o.set] = used[o.set] || new Map()
    used[o.set].set(s.id, (used[o.set].get(s.id) || 0) + 1)
  }))
  const out = ['| option_set | What it is | Steps (rows) |', '|---|---|---|']
  OPTION_SETS.forEach((set) => {
    const where = used[set] ? [...used[set]].map(([id, n]) => `${id} (${n})`).join(', ') : ''
    out.push(`| ${code(set)} | ${md(SET_MEANING[set])} | ${where} |`)
  })
  return out.join('\n')
}

/* What value_json holds, for one step, in a few words */
function holds(s) {
  const D = s.data || {}
  const nCards = (D.cards || []).length
  const pileLabel = (stepId, pileId) => ((BY_ID[stepId].data.piles || []).find((p) => p.id === pileId) || {}).label || pileId
  switch (s.template) {
    case 'flow': case 'break': return 'Nothing (no answer row)'
    case 'checklist':
      if (D.mode === 'region-market') return "`{ region, market }`: a region id and the name of one of its markets; for Another market, the typed name, with region `''` if none was tapped"
      if (D.mode === 'two') return `A list of ${D.min || 1} or ${D.max || 2} option ids, in the order picked`
      return `One option id, of ${D.options.length}`
    case 'text':
      return `\`{ ${D.fields.map((f) => f.id).join(', ')} }\`: text of up to ${D.fields.map((f) => f.limit).join(' / ')} characters${D.optional ? ' (optional)' : ''}${D.chip ? `; the chip writes \`${D.chip.value}\` into ${D.chip.fills}, with no flag of its own` : ''}`
    case 'newspaper': return `\`{ headline, quote }\`: text of up to ${D.limits.headline.hard} and ${D.limits.quote.hard} characters, at least ${D.limits.headline.min} and ${D.limits.quote.min} once cleaned (line breaks to spaces, double spaces closed up, trimmed, quote marks off the quote's ends)`
    case 'piles': return `\`{ cardId: pileId }\` for all ${nCards} cards, keys in the order placed`
    case 'podium':
      return D.optionsFrom
        ? `\`[1st, 2nd, 3rd]\`: cards of ${D.optionsFrom.step} that were put in ${pileLabel(D.optionsFrom.step, D.optionsFrom.pile)}; \`null\` for an empty place`
        : `\`[1st, 2nd, 3rd]\`: ids of its ${D.options.length} options; \`null\` for an empty place`
    case 'configure': return '`{ execute, engage, entrust }`, each `{ belongs, covers: [], who }`; Not for HNW saves `{ belongs: "not-hnw", covers: [], who: null }`'
    case 'track': return D.numeric ? `A number from ${D.min} to ${D.max} in steps of ${D.step} (per cent)` : `One stop id, of ${D.stops.length}`
    case 'trays': return D.tilesFrom
      ? '`{ tileId: trayId }` for every tile offered (those not put in Not for HNW on 2.2, plus business-banking); keys in save order, which a revisit may rewrite'
      : `\`{ tileId: trayId }\` for all ${D.tiles.length} tiles; keys in save order, which a revisit may rewrite`
    case 'ladder': return '`{ base, banking, mortgage, retirement, insurance, alternatives, four }`: whole per cents; rows and four at or above base'
    case 'rank': return `\`[blockId, ...]\`, all ${D.blocks.length}, rank 1 first`
    case 'sentence': {
      if (D.rowsFrom) {
        const r = roleSlotOf(D)
        return `\`{ roleId: number }\` for each role stamped Only above an amount on ${D.rowsFrom.step}: $${r.min}-${r.max}mm, steps of ${r.step}`
      }
      const slots = sentenceSlotsOf(D)
      const one = (p) => (p.slot === 'chips' ? `${p.id}: ${p.options.map((o) => o.id).join(', ')}` : /mm$/.test(p.suffix || '') ? `${p.id}: $${p.min}-${p.max}mm` : `${p.id}: ${p.min} to ${p.max.toLocaleString('en-GB')}`)
      return '`{ ' + slots.map((p) => p.id).join(', ') + ' }` (' + slots.map(one).join('; ') + ')' + (D.optOut ? `, or \`'${D.optOut.id}'\`` : '')
    }
    case 'stamp':
      return D.mode === 'pick-line'
        ? `One card id of ${D.optionsFrom.step}, a card stamped \`${D.optionsFrom.stamps.join('` or `')}\` there`
        : `\`{ cardId: stampId }\` for all ${nCards} cards (${D.stamps.map((t) => t.id).join(', ')}); keys in save order, which a revisit may rewrite`
    case 'allocate-ledger': return D.split
      ? '`{ split, rowId: $mm }`: split 0 to 10, and the rows add up to it. While the split is 0 (or not typed) the Banking and cash column is closed: any rows saved count as nothing'
      : "`{ rowId: $mm }`: the rows add up to $10mm less 5.1's split. With a split of 10 there is nothing to place: any rows saved count as nothing"
    case 'allocate-list': return '`{ rowId: per cent }`: whole numbers adding up to 100'
    case 'bottle': return '`{ md, ed, vp, associate }`: bankers, adding up to 10'
    default: return ''
  }
}
function sentenceSlotsOf(D) {
  const out = []
  ;(D.rows || []).forEach((r) => r.parts.forEach((p) => { if (p && typeof p === 'object') out.push(p) }))
  return out
}
const roleSlotOf = (D) => D.rowParts.find((p) => p && p.slot === 'number')

/* The answer_item rows a step yields, in a few words */
function yields(s) {
  const D = s.data || {}
  switch (s.template) {
    case 'flow': case 'break': return ''
    case 'checklist':
      if (D.mode === 'region-market') return "item_id = the region, attribute region; and item_id = the market's name (or `other`), attribute market, value_text = the market"
      return D.mode === 'two' ? 'One per pick: item_id = the option, attribute choice, seq = order picked' : 'item_id = the option, attribute choice'
    case 'text': return 'One per field with text: item_id = the field, attribute text, value_text = the text, trimmed' + (D.chip ? `. When the name is exactly \`${D.chip.value}\` (the chip, or the same words typed): also item_id = ${D.chip.fills}, attribute chip, value_text = \`${D.chip.value}\`` : '')
    case 'newspaper': return 'One per field with text: item_id = headline or quote, attribute text, value_text = the text cleaned as the page cleans it'
    case 'piles': return 'One per card: item_id = the card, attribute pile, value_text = the pile, seq = order placed'
    case 'podium': return `One per place filled: item_id = the ${D.optionsFrom ? `card (a card of ${D.optionsFrom.step})` : 'option'}, attribute rank, value_number = seq = 1, 2, 3`
    case 'configure': return 'Per item (execute, engage, entrust): attribute belongs, value_text; one covers row per product, value_text, seq; attribute who, value_text'
    case 'track': return D.numeric ? 'item_id = the stop (`60`), attribute percent, value_number = 60' : 'item_id = the stop, attribute stop, value_number = its position on the scale'
    case 'trays': return 'One per tile: item_id = the tile, attribute tray, value_text = the tray, seq = save order'
    case 'ladder': return 'One per key: item_id = base, a row or four, attribute percent, value_number'
    case 'rank': return 'One per block: item_id = the block, attribute rank, value_number = seq = the rank'
    case 'sentence':
      if (D.rowsFrom) return 'One per role: item_id = the role, attribute amount_mm, value_number'
      return sentenceSlotsOf(D).map((p) => (p.slot === 'chips' ? `item_id = ${p.id}, attribute chip, value_text = the word` : `item_id = ${p.id}, attribute ${/mm$/.test(p.suffix || '') ? 'amount_mm' : 'number'}, value_number`)).join('; ') + (D.optOut ? `. Never: item_id = ${D.optOut.id}, attribute opt_out` : '')
    case 'stamp': return D.mode === 'pick-line' ? `item_id = the card (a card of ${D.optionsFrom.step}), attribute choice` : 'One per card: item_id = the card, attribute stamp, value_text = the stamp, seq = save order'
    case 'allocate-ledger': return D.split
      ? 'One per key: item_id = split or a row, attribute amount_mm, value_number. With a split of 0, the split row only; with no split typed, none'
      : "One per key: item_id = a row, attribute amount_mm, value_number; none when 5.1's split is 10"
    case 'allocate-list': return 'One per row typed: item_id = the row, attribute percent, value_number'
    case 'bottle': return 'One per jug: item_id = the jug, attribute count, value_number'
    default: return ''
  }
}

/* A short example of the saved value: R000001's, long text and long records cut */
function example(s) {
  if (!storesAnswer(s)) return ''
  const v = SAMPLES[0].rows[s.id].value
  const cut = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const keys = Object.keys(v)
    const show = keys.slice(0, 3).map((k) => {
      const x = v[k]
      const val = typeof x === 'string' ? JSON.stringify(cut(x, 24)) : JSON.stringify(x)
      return `${JSON.stringify(k)}:${val}`
    })
    return '`{' + show.join(',') + (keys.length > 3 ? `, …${keys.length - 3} more` : '') + '}`'
  }
  return '`' + JSON.stringify(v) + '`'
}

/* The question, shortened at a word boundary; a screen with no question gets its title */
function shortQuestion(s) {
  if (!s.question) return s.title
  const q = s.question.replace(/\s+/g, ' ')
  if (q.length <= 90) return q
  const cut = q.slice(0, 89)
  return cut.slice(0, cut.lastIndexOf(' ')) + ' …'
}

function stepsSection() {
  const out = ['| Step | Kind | Template | Question (short) | value_json holds | Example (R000001) | answer_item rows (R000001\'s count) |', '|---|---|---|---|---|---|---|']
  STEPS.forEach((s) => {
    const n = storesAnswer(s) ? ` (${SAMPLES[0].rows[s.id].items.length})` : ''
    const kind = s.kind + (s.previewCondition ? ', conditional' : '') + (s.sensitive ? ', wave 1 only' : '')
    out.push(`| ${s.id} | ${kind} | ${s.template} | ${md(shortQuestion(s))} | ${md(holds(s))} | ${md(example(s))} | ${md(yields(s))}${n} |`)
  })
  return out.join('\n')
}

function replaceSection(doc, name, body) {
  const start = `<!-- BEGIN GENERATED: ${name} (tools/build-sql.mjs) -->`
  const end = `<!-- END GENERATED: ${name} -->`
  const i = doc.indexOf(start)
  const j = doc.indexOf(end)
  if (i < 0 || j < i) fail(`data-dictionary.md has no ${name} markers`)
  return doc.slice(0, i + start.length) + '\n' + body + '\n' + doc.slice(j)
}

/* ============================================================================================================ go */

const s02 = sql02()
writeFileSync(path.join(SQL_DIR, '02-questionnaire-v3.sql'), s02.text)
writeFileSync(path.join(SQL_DIR, '03-sample-respondent.sql'), sql03())
writeFileSync(path.join(SQL_DIR, '05-checks.sql'), sql05(s02.options))

const dictPath = path.join(DATA_DIR, 'data-dictionary.md')
let doc = readFileSync(dictPath, 'utf8')
doc = replaceSection(doc, 'tables', tablesSection())
doc = replaceSection(doc, 'option sets', setsSection())
doc = replaceSection(doc, 'steps', stepsSection())
writeFileSync(dictPath, doc)

console.log(`script   ${rel(scriptFile)} sha256 ${sha256}`)
console.log(`02       ${STEPS.length} steps, ${s02.options} options`)
console.log(`03       ${SAMPLES.length} respondents, ${TOTALS.answers} answer rows (${TOTALS.notShown} not shown, ${TOTALS.values} with a value), ${TOTALS.items} answer_item rows, ${TOTALS.events} answer_event rows (every shown answer complete)`)
console.log(`05       ${queries04().length} queries from 04 wrapped; data-dictionary.md sections rebuilt`)
