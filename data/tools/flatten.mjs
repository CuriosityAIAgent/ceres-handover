/*
 * Ceres (questionnaire v3): the reference mapping from a saved answer to answer_item rows, and the checks on a
 * saved answer. Plain JavaScript, no dependencies, written to be ported function by function (Java, C#, Python ...).
 *
 *   flatten(step, value, ctx)    the answer_item rows for one saved answer (ctx only matters for 5.2)
 *   validate(step, value, ctx)   is the answer well formed, and does it meet the screen's completion rule?
 *   shows(step, answers, ctx)    does a conditional step fire, given the answers before it? (answer.shown)
 *   refs(step)                   which step_option rows answer_item.item_id and value_text point to
 *
 * `step` is one step of script.js (window.CERES_SCRIPT.steps). `value` is the saved answer, parsed from
 * answer.value_json. Parse with a JSON reader that keeps the order of object keys: a card sort's keys are in the order
 * the cards were placed. JSON.parse keeps it (JavaScript only reorders integer-like keys, and no key in a Ceres answer
 * is one); so do Jackson's ObjectNode, Gson's JsonObject, System.Text.Json's JsonDocument and JsonObject (not a plain
 * .NET Dictionary), and Python's json.
 *
 * `ctx` (validate, shows, and flatten for 5.2):
 *   ctx.steps     every step of script.js (an array, or an object keyed by id). Needed for 2.2a, 2.5a, 6.3a, 7.2a and
 *                 8.1a, whose options are another step's cards.
 *   ctx.answers   this submission's other answers, keyed by step id. Optional, but full strictness needs them. Without
 *                 the answer a check depends on, that check is relaxed and a note says so: the Critical pile behind a
 *                 top 3; 2.2's Not for HNW pile behind 2.3's products (their minimum is skipped) and 2.6's tiles (only
 *                 the always-offered tile is required); 4.3's stamps behind 4.3a; 8.1's stamps behind 8.1a; 5.1's
 *                 split behind 5.2 (the total is not checked, and flatten keeps 5.2's rows); whether a conditional
 *                 step shows at all.
 *   ctx.wave      2 for the market-manager wave: steps and cards marked `sensitive` are not asked.
 *   ctx.fallback  true if 8.2a runs its fallback question (data.fallback); its options then become valid.
 *
 * validate() returns { ok, complete, errors, incomplete, notes }. A step that does not show (shows() false) is ok and
 * complete whatever came with it, with a note: store shown = false and value_json NULL for it.
 */

/* Templates whose steps save an answer. flow (W, 0.1, pause, end) and break save nothing. */
export const STORING_TEMPLATES = ['checklist', 'text', 'piles', 'podium', 'configure', 'track', 'trays', 'ladder',
  'rank', 'sentence', 'stamp', 'allocate-ledger', 'allocate-list', 'bottle', 'newspaper']

/* Every value answer_item.attribute can take (01-schema.sql checks the same list). */
export const ATTRIBUTES = ['choice', 'region', 'market', 'text', 'pile', 'rank', 'belongs', 'covers', 'who', 'stop',
  'percent', 'tray', 'amount_mm', 'number', 'chip', 'opt_out', 'stamp', 'count']

export const storesAnswer = (step) => STORING_TEMPLATES.includes(step.template)

/* ------------------------------------------------------------------------------------------------ small helpers */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isInt = (v) => isNum(v) && Math.floor(v) === v
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const ids = (list) => (list || []).map((o) => o.id)
const tenths = (v) => Math.round(v * 10)
const mm = (t) => `$${(t / 10).toFixed(1)}mm`
function decimalsOk(v, d) { const f = Math.pow(10, d || 0); return Math.abs(Math.round(v * f) - v * f) < 1e-6 }

function stepFrom(ctx, id) {
  const S = ctx && ctx.steps
  if (!S) return null
  if (Array.isArray(S)) return S.find((s) => s.id === id) || null
  return S[id] || null
}
function answerFrom(ctx, id) {
  return ctx && ctx.answers && has(ctx.answers, id) ? ctx.answers[id] : undefined
}

/* The number and word-chip slots of a sentence step, in the order they appear. */
function sentenceSlots(D) {
  const out = []
  ;(D.rows || []).forEach((r) => (r.parts || []).forEach((p) => {
    if (p && typeof p === 'object' && (p.slot === 'number' || p.slot === 'chips')) out.push(p)
  }))
  return out
}
/* 4.3a: the number slot every role row uses. */
const roleSlot = (D) => (D.rowParts || []).find((p) => p && p.slot === 'number')
/* A number slot in $mm is an amount; any other number slot is a plain number (clients, meetings, bankers). */
const numberAttribute = (slot) => (slot && /mm$/.test(slot.suffix || '') ? 'amount_mm' : 'number')

/* The cards of a card-sort answer that sit in one pile, in placement order. */
function pileCards(pilesAnswer, pileId) {
  return isObj(pilesAnswer) ? Object.keys(pilesAnswer).filter((k) => pilesAnswer[k] === pileId) : null
}
/* 9.4b: is the market one of the listed markets of the region? If not, it was typed in Another market. */
function listedMarket(D, region, market) {
  const r = (D.regions || []).find((g) => g.id === region)
  return !!r && r.markets.includes(market)
}
/* 2.3: the options a part offers an item: the part's own options, less those `only` keeps for other items, less (for
   part 2) the products put in Not for HNW on 2.2. { list, known }: known is false when the list depends on 2.2's answer
   and ctx.answers does not have it; the list is then every option, and what was really offered is unknown. */
function partOptions(part, item, ctx) {
  let list = (part.options || []).filter((o) => !o.only || o.only.includes(item.id))
  let known = true
  if (part.optionsFrom) {
    const src = answerFrom(ctx, part.optionsFrom.step)
    known = isObj(src)
    if (known) list = list.filter((o) => src[o.id] !== part.optionsFrom.excludePile)
  }
  return { list, known }
}
/* 2.6: the tiles offered: those not put in Not for HNW on 2.2, plus `always` tiles. { tiles, known }, as partOptions. */
function offeredTiles(D, ctx) {
  const F = D.tilesFrom
  const src = F ? answerFrom(ctx, F.step) : undefined
  const known = !F || isObj(src)
  return { tiles: (D.tiles || []).filter((t) => !F || t.always || !known || src[t.id] !== F.excludePile), known }
}
/* 10.5: the page's own clean-up of the front page (t-newspaper.html, clean and stripQuotes): line breaks become
   spaces, runs of spaces close up, the ends are trimmed, and the quote loses any quote marks at either end. */
const QUOTE_CHARS = '"\'“”„‟«»‘’‚‛‹›`´'
const QUOTE_CLASS = QUOTE_CHARS.replace(/[\\\]^-]/g, '\\$&')
const stripQuotes = (s) => s.replace(new RegExp(`^[\\s${QUOTE_CLASS}]+`), '').replace(new RegExp(`[\\s${QUOTE_CLASS}]+$`), '')
const oneLine = (s) => s.replace(/[\r\n]+/g, ' ').replace(/ {2,}/g, ' ')
function paperText(field, v) {
  const s = oneLine(String(v == null ? '' : v))
  return (field === 'quote' ? stripQuotes(s) : s).trim()
}
/* Stamp decks: the cards shown (wave 2 drops `sensitive` cards: 8.1's published price list). */
const offeredCards = (D, ctx) => (D.cards || []).filter((c) => !(ctx && ctx.wave === 2 && c.sensitive))
/* 5.2: what is left to place, in tenths of $mm: $10mm less 5.1's split. null when 5.1's answer is not known. */
function restOf10(D, ctx) {
  const src = answerFrom(ctx, D.cashFrom)
  return isObj(src) && isNum(src.split) ? 100 - tenths(src.split) : null
}

/* ======================================================================================================= flatten */

/**
 * The answer_item rows for one saved answer: [{ item_id, attribute, value_text, value_number, seq }].
 * seq: an array element's position (podium, rank: the rank; a pick-two list: the order picked; 2.3's covers: list
 * order); an object key's position (card sorts: the order placed; trays and stamps: the order saved, which a revisit
 * may rewrite; other records: the order saved); 1 for a single value (one choice, a stop, 2.3's belongs and who,
 * 9.4b's region and market).
 * Text is trimmed (10.5 is cleaned as its page cleans it) and an empty text field yields no row. Amounts behind a
 * closed ledger column yield no rows: 5.1's rows while its split is 0 or not typed, 5.2's rows when 5.1's split is 10
 * (that one needs ctx.answers['5.1']; without it 5.2's rows are kept). Assumes the answer is well formed (validate).
 */
export function flatten(step, value, ctx = {}) {
  if (value === undefined || value === null) return []
  const D = step.data || {}
  const rows = []
  const add = (itemId, attribute, valueText, valueNumber, seq) => rows.push({
    item_id: String(itemId),
    attribute,
    value_text: valueText == null ? null : String(valueText),
    value_number: valueNumber == null ? null : Number(valueNumber),
    seq,
  })
  const each = (fn) => Object.keys(value).forEach((k, i) => fn(k, value[k], i + 1))

  switch (step.template) {
    case 'checklist':
      if (D.mode === 'region-market') {
        // 9.4b: { region, market }. region is '' when Another market was typed without a region.
        if (value.region) add(value.region, 'region', null, null, 1)
        const market = String(value.market || '').trim()
        if (market) add(listedMarket(D, value.region, market) ? market : D.other.id, 'market', market, null, 1)
      } else if (Array.isArray(value)) value.forEach((id, i) => add(id, 'choice', null, null, i + 1))
      else add(value, 'choice', null, null, 1)
      break
    case 'text':
      each((k, v, i) => {
        const t = String(v == null ? '' : v).trim()
        if (t) add(k, 'text', t, null, i)
        // 10.3: the chip "No one does it well" writes data.chip.value ('no one') into the name field, with no flag of
        // its own; a name of exactly that text gets a chip row too (typing the same words cannot be told apart)
        if (D.chip && k === D.chip.fills && v === D.chip.value) add(k, 'chip', D.chip.value, null, i)
      })
      break
    case 'newspaper':
      each((k, v, i) => { const t = paperText(k, v); if (t) add(k, 'text', t, null, i) })
      break
    case 'piles':
      each((k, v, i) => add(k, 'pile', v, null, i))
      break
    case 'stamp':
      if (D.mode === 'pick-line') add(value, 'choice', null, null, 1)   // 8.1a: one of 8.1's cards
      else each((k, v, i) => add(k, 'stamp', v, null, i))               // seq: the order saved
      break
    case 'trays':
      each((k, v, i) => add(k, 'tray', v, null, i))                     // seq: the order saved
      break
    case 'podium':   // [first, second, third]; an empty place is null
    case 'rank':     // [rank 1, rank 2, ...]
      value.forEach((id, i) => { if (id) add(id, 'rank', null, i + 1, i + 1) })
      break
    case 'configure':   // 2.3: { item: { belongs, covers: [], who } }
      each((item, o) => {
        if (!isObj(o)) return
        if (o.belongs) add(item, 'belongs', o.belongs, null, 1)
        ;(o.covers || []).forEach((p, i) => add(item, 'covers', p, null, i + 1))
        if (o.who) add(item, 'who', o.who, null, 1)
      })
      break
    case 'track':
      // 7.1 (numeric, the only one in v3) saves the per cent itself; a word scale saves the stop id, and
      // value_number is the stop's position on the scale (1 = the first stop)
      if (D.numeric) add(String(value), 'percent', null, value, 1)
      else add(value, 'stop', null, ids(D.stops).indexOf(value) + 1 || null, 1)
      break
    case 'ladder':   // 3.1: { base, <row>..., four }, per cent
      each((k, v, i) => add(k, 'percent', null, v, i))
      break
    case 'sentence': {
      if (D.optOut && value === D.optOut.id) { add(value, 'opt_out', null, null, 1); break }   // 4.2: 'never'
      if (D.rowsFrom) { const s = roleSlot(D); each((k, v, i) => add(k, numberAttribute(s), null, v, i)); break }   // 4.3a
      const slots = sentenceSlots(D)
      each((k, v, i) => {
        const s = slots.find((p) => p.id === k)
        if (s && s.slot === 'chips') add(k, 'chip', v, null, i)
        else add(k, numberAttribute(s), null, v, i)
      })
      break
    }
    case 'allocate-ledger': { // 5.1 { split, <row>: $mm }, 5.2 { <row>: $mm }
      // a closed column's rows count as nothing (the screen may still have saved old amounts there)
      const closed = D.phase === 'cash' ? !(isNum(value.split) && value.split > 0) : restOf10(D, ctx) === 0
      each((k, v, i) => { if (k === 'split' || !closed) add(k, 'amount_mm', null, v, i) })
      break
    }
    case 'allocate-list':     // 5.4a { <row>: per cent }
      each((k, v, i) => add(k, 'percent', null, v, i))
      break
    case 'bottle':            // 6.4 { md, ed, vp, associate }: bankers out of 10
      each((k, v, i) => add(k, 'count', null, v, i))
      break
    default:
      break   // flow and break steps save nothing
  }
  return rows
}

/* ====================================================================================================== validate */

/**
 * { ok, complete, errors, incomplete, notes }.
 *   errors      the value is malformed, has a shape the screen never saves, or names something the screen never
 *               offers: reject the save.
 *   incomplete  a well-formed answer that does not meet the screen's rule yet (a partial save while the respondent
 *               is still on the screen): accept it while in progress; the screen's Next asks for the rest.
 *   notes       what was ignored or could not be checked (a step that does not show; amounts behind a closed ledger
 *               column; a check relaxed because ctx.answers lacks the answer it depends on).
 *   ok          no errors.  complete: ok and nothing missing.
 */
export function validate(step, value, ctx = {}) {
  const errors = []
  const incomplete = []
  const notes = []
  const x = { ctx, err: (m) => errors.push(m), need: (m) => incomplete.push(m), note: (m) => { if (!notes.includes(m)) notes.push(m) } }
  const D = step.data || {}
  const none = value === undefined || value === null
  const result = () => ({ ok: errors.length === 0, complete: errors.length === 0 && incomplete.length === 0, errors, incomplete, notes })
  if (!storesAnswer(step)) {
    if (!none) x.err('this step saves nothing')
    return result()
  }
  // a step that does not show (a conditional step that did not fire, a wave-1-only step in wave 2) needs no answer;
  // whatever came with it is ignored, and the caller stores shown = false and value_json NULL
  if (shows(step, ctx.answers || {}, ctx) === false) {
    x.note(none ? 'not shown' : 'not shown: the value is ignored (store shown = false and value_json NULL)')
    return result()
  }
  if (none) {
    // nothing saved: complete only for the optional 10.4, and for 5.2 when 5.1 put all $10mm in banking and cash
    const nothingToPlace = step.template === 'allocate-ledger' && D.phase === 'inv' && restOf10(D, ctx) === 0
    if (!D.optional && !nothingToPlace) x.need('no answer yet')
    return result()
  }
  if (isObj(value) && !Object.keys(value).length) x.err('an empty object is never saved (an empty answer saves nothing)')
  else CHECKS[step.template](step, value, x)
  return result()
}

const CHECKS = {
  checklist(step, v, x) {
    const D = step.data
    if (D.mode === 'region-market') {
      if (!isObj(v)) return x.err('expected { region, market }')
      Object.keys(v).forEach((k) => { if (k !== 'region' && k !== 'market') x.err(`unexpected key '${k}'`) })
      const region = v.region == null ? '' : v.region
      const market = v.market == null ? '' : v.market
      if (typeof region !== 'string' || typeof market !== 'string') return x.err('region and market must be text')
      if (region !== '' && !ids(D.regions).includes(region)) x.err(`unknown region '${region}'`)
      const limit = (D.other && D.other.field && D.other.field.limit) || 40
      if (market.length > limit) x.err(`market is longer than ${limit} characters`)
      if (market !== market.trim()) x.err('market is saved trimmed')
      if (listedMarket(D, region, market)) return
      if (market === '') x.need(region ? 'tap a market' : 'tap a region, then a market')
      else if (market.trim().length < 2) x.need('type at least 2 characters for Another market')
      return
    }
    const known = (id) => ids(D.options).includes(id) || (!!x.ctx.fallback && !!D.fallback && ids(D.fallback.options).includes(id))
    if (D.mode === 'two') {
      if (!Array.isArray(v)) return x.err('expected a list of option ids')
      if (!v.length) return x.err('an empty list is never saved (nothing picked saves no answer)')
      v.forEach((id) => { if (typeof id !== 'string' || !known(id)) x.err(`unknown option '${id}'`) })
      if (new Set(v).size !== v.length) x.err('an option is picked twice')
      if (v.length > (D.max || 2)) x.err(`more than ${D.max || 2} picks`)
      if (v.length < (D.min || 1)) x.need(`pick at least ${D.min || 1}`)
      return
    }
    if (typeof v !== 'string') return x.err('expected one option id')
    if (!known(v)) x.err(`unknown option '${v}'`)
  },

  text(step, v, x) {
    const D = step.data
    if (!isObj(v)) return x.err('expected { fieldId: text }')
    const fields = D.fields || []
    Object.keys(v).forEach((k) => {
      const f = fields.find((g) => g.id === k)
      if (!f) return x.err(`unknown field '${k}'`)
      if (typeof v[k] !== 'string') return x.err(`'${k}' must be text`)
      if (v[k].length > f.limit) x.err(`'${k}' is longer than ${f.limit} characters`)
    })
    if (D.optional) return
    fields.forEach((f) => {
      if (f.required && String(v[f.id] || '').trim().length < (f.min || 1)) x.need(`write at least ${f.min || 1} characters in '${f.id}'`)
    })
  },

  newspaper(step, v, x) {
    const L = step.data.limits
    if (!isObj(v)) return x.err('expected { headline, quote }')
    Object.keys(v).forEach((k) => { if (!L[k]) x.err(`unexpected key '${k}'`) })
    Object.keys(L).forEach((k) => {
      const t = v[k] == null ? '' : v[k]
      if (typeof t !== 'string') return x.err(`'${k}' must be text`)
      if (t.length > L[k].hard) x.err(`'${k}' is longer than ${L[k].hard} characters`)
      // the minimum is counted on the text as the page cleans it (paperText)
      if (paperText(k, t).length < (L[k].min || 1)) x.need(`write at least ${L[k].min || 1} characters in '${k}'`)
    })
  },

  piles(step, v, x) {
    const D = step.data
    if (!isObj(v)) return x.err('expected { cardId: pileId }')
    Object.keys(v).forEach((k) => {
      if (!ids(D.cards).includes(k)) x.err(`unknown card '${k}'`)
      if (!ids(D.piles).includes(v[k])) x.err(`unknown pile '${v[k]}' for '${k}'`)
    })
    const left = ids(D.cards).filter((c) => !has(v, c)).length
    if (left) x.need(`sort ${left} more`)
  },

  podium(step, v, x) {
    const D = step.data
    if (!Array.isArray(v)) return x.err('expected [first, second, third]')
    if (v.length !== 3) return x.err('a podium is saved as exactly three places (null for an empty one)')
    let allowed = ids(D.options)
    let inPile = null
    const F = D.optionsFrom
    if (F) {
      // a top 3 picks from the parent's cards, and only those in its Critical pile
      const parent = stepFrom(x.ctx, F.step)
      if (!parent) return x.err(`step ${F.step} not found: pass ctx.steps`)
      allowed = ids(parent.data.cards)
      inPile = pileCards(answerFrom(x.ctx, F.step), F.pile)
    }
    const picks = v.filter((id) => id !== null)
    picks.forEach((id) => {
      if (typeof id !== 'string' || !allowed.includes(id)) x.err(`unknown card '${id}'`)
      else if (inPile && !inPile.includes(id)) x.err(`'${id}' is not in the ${F.pile} pile on ${F.step}`)
    })
    if (new Set(picks).size !== picks.length) x.err('a card is placed twice')
    if (picks.length < 3) x.need(picks.length ? `pick ${3 - picks.length} more` : 'pick 3')
  },

  configure(step, v, x) {
    const D = step.data
    if (!isObj(v)) return x.err('expected { itemId: { belongs, covers, who } }')
    const skip = D.skipRest
    Object.keys(v).forEach((k) => { if (!ids(D.items).includes(k)) x.err(`unknown item '${k}'`) })
    D.items.forEach((item) => {
      const a = v[item.id]
      if (a === undefined) return x.need(`${item.label}: ${D.ui.missing[D.parts[0].id]}`)
      if (!isObj(a)) return x.err(`'${item.id}' must be { ${ids(D.parts).join(', ')} }`)
      Object.keys(a).forEach((k) => { if (!ids(D.parts).includes(k)) x.err(`unexpected part '${k}' in '${item.id}'`) })
      const skipped = !!skip && a[skip.part] === skip.on   // Not for HNW skips the other two parts
      D.parts.forEach((p) => {
        const { list: offeredList, known } = partOptions(p, item, x.ctx)
        const offered = ids(offeredList)
        const val = a[p.id]
        const where = p.optionsFrom ? ` (not offered: put in ${p.optionsFrom.excludePile} on ${p.optionsFrom.step})` : ''
        if (p.mode === 'any') {
          const list = val == null ? [] : val
          if (!Array.isArray(list)) return x.err(`'${item.id}'.${p.id} must be a list`)
          list.forEach((id) => {
            if (!ids(p.options).includes(id)) x.err(`unknown ${p.id} option '${id}' in '${item.id}'`)
            else if (!offered.includes(id)) x.err(`'${id}' in '${item.id}'.${p.id}${where}`)
          })
          if (new Set(list).size !== list.length) x.err(`'${item.id}'.${p.id} lists an option twice`)
          if (skipped) { if (list.length) x.err(`'${item.id}' is ${skip.on}, so ${p.id} must be empty`); return }
          if (!known) {
            // what part 2 offered depends on 2.2's answer: without it, its minimum cannot be judged
            x.note(`${p.optionsFrom.step}'s answer not supplied: the minimum for ${p.id} is not checked`)
            return
          }
          if (list.length < Math.min(p.min || 1, offered.length)) x.need(`${item.label}: ${D.ui.missing[p.id]}`)
          return
        }
        if (val != null && typeof val !== 'string') return x.err(`'${item.id}'.${p.id} must be one option id`)
        if (val != null && !ids(p.options).includes(val)) x.err(`unknown ${p.id} option '${val}' in '${item.id}'`)
        else if (val != null && !offered.includes(val)) x.err(`'${val}' is not offered for '${item.id}'`)
        if (skipped && p.id !== skip.part) { if (val != null) x.err(`'${item.id}' is ${skip.on}, so ${p.id} must be empty`); return }
        if (val == null) x.need(`${item.label}: ${D.ui.missing[p.id]}`)
      })
    })
  },

  track(step, v, x) {
    const D = step.data
    if (D.numeric) {
      if (!isNum(v)) return x.err('expected a number')
      if (!D.stops.some((s) => Number(s.id) === v)) x.err(`${v} is not a stop on the scale`)
      return
    }
    if (typeof v !== 'string') return x.err('expected one stop id')
    if (!ids(D.stops).includes(v)) x.err(`unknown stop '${v}'`)
  },

  trays(step, v, x) {
    const D = step.data
    if (!isObj(v)) return x.err('expected { tileId: trayId }')
    const { tiles, known } = offeredTiles(D, x.ctx)
    const offered = ids(tiles)
    Object.keys(v).forEach((k) => {
      if (!ids(D.tiles).includes(k)) x.err(`unknown tile '${k}'`)
      else if (!offered.includes(k)) x.err(`tile '${k}' is not offered (put in ${D.tilesFrom.excludePile} on ${D.tilesFrom.step})`)
      if (!ids(D.trays).includes(v[k])) x.err(`unknown tray '${v[k]}' for '${k}'`)
    })
    // without 2.2's answer, only the tiles always offered are certain to have been on the screen
    const required = known ? offered : ids(D.tiles.filter((t) => t.always))
    if (!known) x.note(`${D.tilesFrom.step}'s answer not supplied: only the tiles always offered are required`)
    const left = required.filter((t) => !has(v, t)).length
    if (left) x.need(`place ${left} more`)
  },

  ladder(step, v, x) {
    const D = step.data
    if (!isObj(v)) return x.err('expected { base, <row>..., four }')
    const rows = ids(D.rows)
    const keys = ['base'].concat(rows, ['four'])
    Object.keys(v).forEach((k) => {
      if (!keys.includes(k)) return x.err(`unexpected key '${k}'`)
      if (!isInt(v[k]) || v[k] < 0 || v[k] > 100) x.err(`'${k}' must be a whole per cent from 0 to 100`)
    })
    if (isNum(v.base)) rows.concat(['four']).forEach((k) => {
      if (isNum(v[k]) && v[k] < v.base) x.err(`'${k}' (${v[k]}%) is below today's share (${v.base}%)`)
    })
    if (!has(v, 'base')) x.need("set today's share")
    const unset = rows.filter((r) => !has(v, r)).length
    if (unset) x.need(`set ${unset} more rows`)
    if (!has(v, 'four')) x.need('set one share for all four')
  },

  rank(step, v, x) {
    const blocks = ids(step.data.blocks)
    if (!Array.isArray(v)) return x.err('expected a list of block ids, rank 1 first')
    if (!v.length) return x.err('an empty list is never saved (nothing placed saves no answer)')
    v.forEach((id) => { if (!blocks.includes(id)) x.err(`unknown block '${id}'`) })
    if (new Set(v).size !== v.length) x.err('a block is placed twice')
    if (v.length > blocks.length) x.err('more places than blocks')
    else if (v.length < blocks.length) x.need(`place ${blocks.length - v.length} more`)
  },

  sentence(step, v, x) {
    const D = step.data
    if (D.optOut && v === D.optOut.id) return
    if (!isObj(v)) return x.err(D.optOut ? `expected { slot: value } or '${D.optOut.id}'` : 'expected { slot: value }')
    const number = (k, n, slot) => {
      if (!isNum(n)) return x.err(`'${k}' must be a number`)
      if (!decimalsOk(n, slot.decimals || 0)) x.err(`'${k}' has more than ${slot.decimals || 0} decimal places`)
      if (n < slot.min || n > slot.max) x.need(`'${k}' must be from ${slot.min} to ${slot.max}`)
    }
    if (D.rowsFrom) {
      // 4.3a: one row per role stamped Only above an amount on 4.3
      const F = D.rowsFrom
      const slot = roleSlot(D)
      const src = answerFrom(x.ctx, F.step)
      const expected = isObj(src) ? F.roles.filter((r) => src[r] === F.stamp) : null
      Object.keys(v).forEach((k) => {
        if (!F.roles.includes(k)) return x.err(`unknown role '${k}'`)
        if (expected && !expected.includes(k)) x.err(`role '${k}' is not stamped '${F.stamp}' on ${F.step}`)
        number(k, v[k], slot)
      })
      ;(expected || Object.keys(v)).forEach((r) => { if (!has(v, r)) x.need(`type an amount for '${r}'`) })
      if (!Object.keys(v).length) x.need('type an amount for each role')
      return
    }
    const slots = sentenceSlots(D)
    Object.keys(v).forEach((k) => {
      const s = slots.find((p) => p.id === k)
      if (!s) return x.err(`unknown slot '${k}'`)
      if (s.slot === 'chips') { if (!ids(s.options).includes(v[k])) x.err(`unknown word '${v[k]}' for '${k}'`) }
      else number(k, v[k], s)
    })
    slots.forEach((s) => { if (!has(v, s.id)) x.need(s.slot === 'chips' ? `tap a word for '${s.id}'` : `type a number for '${s.id}'`) })
  },

  stamp(step, v, x) {
    const D = step.data
    if (D.mode === 'pick-line') {
      // 8.1a: one of 8.1's cards, and only one stamped Do it or Pilot it there
      const F = D.optionsFrom
      const src = stepFrom(x.ctx, F.step)
      if (!src) return x.err(`step ${F.step} not found: pass ctx.steps`)
      if (typeof v !== 'string') return x.err('expected one card id')
      if (!ids(src.data.cards).includes(v)) return x.err(`unknown card '${v}' (the cards come from ${F.step})`)
      if (!ids(offeredCards(src.data, x.ctx)).includes(v)) return x.err(`card '${v}' is not shown in wave 2`)
      const a = answerFrom(x.ctx, F.step)
      if (isObj(a) && !F.stamps.includes(a[v])) x.err(`'${v}' is not stamped ${F.stamps.join(' or ')} on ${F.step}`)
      return
    }
    if (!isObj(v)) return x.err('expected { cardId: stampId }')
    const shown = ids(offeredCards(D, x.ctx))
    Object.keys(v).forEach((k) => {
      if (!ids(D.cards).includes(k)) x.err(`unknown card '${k}'`)
      else if (!shown.includes(k)) x.err(`card '${k}' is not shown in wave 2`)
      if (!ids(D.stamps).includes(v[k])) x.err(`unknown stamp '${v[k]}' for '${k}'`)
    })
    const left = shown.filter((c) => !has(v, c)).length
    if (left) x.need(`stamp ${left} more`)
  },

  'allocate-ledger'(step, v, x) {
    const D = step.data
    const cash = D.phase === 'cash'
    if (!isObj(v)) return x.err('expected { rowId: $mm }')
    const rows = ids(D.rows)
    const keys = cash ? ['split'].concat(rows) : rows
    // what must be placed, in tenths of $mm (no float drift): 5.1 the split; 5.2 $10mm less 5.1's split (null: unknown)
    const target = cash ? (isNum(v.split) ? tenths(v.split) : null) : restOf10(D, x.ctx)
    // a closed column: 5.1's Banking and cash while the split is 0 or not typed; 5.2's Investments when 5.1's split
    // is 10. The screen may keep old amounts there; they count as nothing and are not checked
    const closed = cash ? !(target > 0) : target === 0
    Object.keys(v).forEach((k) => {
      if (!keys.includes(k)) return x.err(`unexpected key '${k}'`)
      if (k !== 'split' && closed) return
      const n = v[k]
      if (!isNum(n) || n < 0 || n > 10) x.err(`'${k}' must be an amount from 0 to 10 ($mm)`)
      else if (!decimalsOk(n, 1)) x.err(`'${k}' has more than one decimal place`)
    })
    if (closed && rows.some((r) => has(v, r))) {
      x.note(cash ? 'amounts in the closed Banking and cash column (split 0 or not typed) are ignored'
        : "amounts are ignored: 5.1's split is $10mm, so there is nothing to place")
    }
    if (cash && target == null) return x.need('type the split')
    if (target == null) return x.note("5.1's answer not supplied: the total is not checked")
    if (closed) return
    const placed = rows.reduce((t, r) => t + (isNum(v[r]) ? tenths(v[r]) : 0), 0)
    if (placed < target) x.need(`${mm(target - placed)} left to place`)
    if (placed > target) x.need(`${mm(placed - target)} too much`)
  },

  'allocate-list'(step, v, x) {
    const D = step.data
    const total = D.total || 100
    if (!isObj(v)) return x.err('expected { rowId: per cent }')
    let sum = 0
    Object.keys(v).forEach((k) => {
      if (!ids(D.rows).includes(k)) return x.err(`unknown row '${k}'`)
      if (!isInt(v[k]) || v[k] < 0 || v[k] > total) return x.err(`'${k}' must be a whole number from 0 to ${total}`)
      sum += v[k]
    })
    if (sum !== total) x.need(sum < total ? `${total - sum}% left to place` : `${sum - total}% too much`)
  },

  bottle(step, v, x) {
    const D = step.data
    if (!isObj(v)) return x.err('expected { jugId: count }')
    const missing = ids(D.jugs).filter((j) => !has(v, j))
    if (missing.length) x.err(`every jug is saved, 0 included: ${missing.join(', ')} missing`)
    let sum = 0
    Object.keys(v).forEach((k) => {
      if (!ids(D.jugs).includes(k)) return x.err(`unknown jug '${k}'`)
      if (!isInt(v[k]) || v[k] < 0) return x.err(`'${k}' must be a whole number`)
      sum += v[k]
    })
    if (sum > D.total) x.err(`more than ${D.total} bankers`)
    else if (sum < D.total) x.need(`add ${D.total - sum} more`)
  },
}

/* ========================================================================================================= shows */

/* The eleven conditional steps of v3 (script.js previewCondition, quoted), as rules over the answers before them.
   Each returns true, false, or null when an answer it needs is missing. */
function top3Rule(A, step) {
  const F = step.data.optionsFrom
  const cards = pileCards(A[F.step], F.pile)
  return cards ? cards.length > 3 : null
}
function investsBeyondExecute(A) {
  const a = A['2.3']
  if (!isObj(a)) return null
  const states = ['engage', 'entrust'].map((it) => (isObj(a[it]) && a[it].belongs ? a[it].belongs !== 'not-hnw' : null))
  if (states.includes(true)) return true
  return states.every((s) => s === false) ? false : null
}
export const CONDITIONS = {
  // "Shows only if Critical holds more than 3 cards."
  '2.2a': top3Rule,
  '2.5a': top3Rule,
  '6.3a': top3Rule,
  '7.2a': top3Rule,
  // "Shows only if Engage or Entrust is not put in Not for HNW on 2.3."
  '2.4': (A) => investsBeyondExecute(A),
  // "Shows only if 2.4 is shown."
  '2.4a': (A) => investsBeyondExecute(A),
  // "Shows only if a role (banker, investment specialist resource, WA, CA or CSS) is stamped Only above an amount."
  '4.3a': (A, step) => {
    const F = step.data.rowsFrom
    const a = A[F.step]
    return isObj(a) ? F.roles.some((r) => a[r] === F.stamp) : null
  },
  // "Shows only if the answer to 5.4 is more than 0."
  '5.4a': (A) => (isObj(A['5.4']) && isNum(A['5.4'].n) ? A['5.4'].n > 0 : null),
  // "Shows only if either number on 6.2 is 1 or more."
  '6.2a': (A) => {
    const a = A['6.2']
    if (!isObj(a)) return null
    if ((isNum(a.first) && a.first >= 1) || (isNum(a.after) && a.after >= 1)) return true
    return isNum(a.first) && isNum(a.after) ? false : null
  },
  // "Shows only if two or more cards are stamped Do it or Pilot it."
  '8.1a': (A, step) => {
    const F = step.data.optionsFrom
    const a = A[F.step]
    return isObj(a) ? Object.keys(a).filter((k) => F.stamps.includes(a[k])).length >= 2 : null
  },
  // "Shows only if the answer to 8.4 is A revenue share for some years."
  '8.4a': (A) => (typeof A['8.4'] === 'string' ? A['8.4'] === 'trailer' : null),
}

/**
 * Does the step show? true for every unconditional step; for the eleven conditional steps, the rule above
 * (null if an answer it needs is missing). In wave 2 (ctx.wave === 2) a `sensitive` step never shows.
 */
export function shows(step, answers = {}, ctx = {}) {
  if (ctx.wave === 2 && step.sensitive) return false
  const rule = CONDITIONS[step.id]
  return rule ? rule(answers || {}, step) : true
}

/* ========================================================================================================== refs */

/**
 * What answer_item rows of this step point to, one entry per attribute:
 *   { attribute, itemStep, itemSets, valueSet, valueParent }
 * item_id is a step_option of step `itemStep` (this step, or the parent for a top 3 and 8.1a) in one of `itemSets`.
 * value_text, when `valueSet` is set, is a step_option of this step in that set; `valueParent` says which column its
 * parent_option_id must equal ('attribute' for 2.3's parts, 'item' for 4.2's word chips). Used by the checks in
 * 05-checks.sql and by the step table in data-dictionary.md.
 */
export function refs(step) {
  const D = step.data || {}
  const self = step.id
  const r = (attribute, itemSets, valueSet = null, valueParent = null, itemStep = self) =>
    ({ attribute, itemStep, itemSets, valueSet, valueParent })
  switch (step.template) {
    case 'checklist':
      if (D.mode === 'region-market') return [r('region', ['region']), r('market', ['market', 'other'])]
      return [r('choice', D.fallback ? ['option', 'fallback'] : ['option'])]
    case 'text':   // 10.3 also gives a chip row when its chip filled the name
      return D.chip ? [r('text', ['field']), r('chip', ['field'], 'chip', 'item')] : [r('text', ['field'])]
    case 'newspaper':
      return [r('text', ['field'])]
    case 'piles':
      return [r('pile', ['card'], 'pile')]
    case 'stamp':
      if (D.mode === 'pick-line') return [r('choice', ['card'], null, null, D.optionsFrom.step)]
      return [r('stamp', ['card'], 'stamp')]
    case 'trays':
      return [r('tray', ['tile'], 'tray')]
    case 'podium':
      return D.optionsFrom ? [r('rank', ['card'], null, null, D.optionsFrom.step)] : [r('rank', ['option'])]
    case 'rank':
      return [r('rank', ['block'])]
    case 'configure':
      return D.parts.map((p) => r(p.id, ['item'], 'part_option', 'attribute'))
    case 'track':
      return D.numeric ? [r('percent', ['stop'])] : [r('stop', ['stop'])]
    case 'ladder':
      return [r('percent', ['row', 'column'])]
    case 'sentence': {
      if (D.rowsFrom) return [r(numberAttribute(roleSlot(D)), ['role'])]
      const out = []
      sentenceSlots(D).forEach((s) => {
        const a = s.slot === 'chips' ? 'chip' : numberAttribute(s)
        if (!out.some((o) => o.attribute === a)) out.push(a === 'chip' ? r(a, ['slot'], 'chip', 'item') : r(a, ['slot']))
      })
      if (D.optOut) out.push(r('opt_out', ['opt_out']))
      return out
    }
    case 'allocate-ledger':
      return [r('amount_mm', D.split ? ['row', 'slot'] : ['row'])]
    case 'allocate-list':
      return [r('percent', ['row'])]
    case 'bottle':
      return [r('count', ['jug'])]
    default:
      return []
  }
}
