# Ceres review preview: the template contract

How a template page works, the step data each template reads, and which pages are expected. The preview lets Adam and
senior reviewers click through every screen of the Ceres survey. It will be hosted at a path on survey.tigerai.tech
behind a passcode, and it must also open straight from disk.

Sources of truth: `design/ceres-design-v3.md` (§2 the experience, §3 play order, §4 every screen) and
`copy/ceres-copy-deck.md` (its "after" column wins for every respondent string). `script.js` copies every string from
them. The QA'd mockups in `mockups/` set the look and the interaction: port their code, don't redesign it.

**v3 (15 Oct 2026).** The preview runs the third draft: `script.js` is a byte-for-byte copy of
`questionnaire/v3/script.js` (Adam's and Chris's notes of 15 Oct), which also builds the Word questionnaire. Edit the
script there, copy it here, and run `node build.mjs` in `questionnaire/v3/` (it must print `checks: clean`). 42
questions, 21 follow-ups (10 conditional), 10 breaks, 77 steps. What changed from v2: chapter I is the four forced
choices (1.1-1.4; the typed words and the keep step are gone); chapter II opens with 2.1, three client quotes (`text`,
skin `quotes`), then products 2.2 (+2.2a), ways of investing 2.3, how much customisation 2.4 (`track`, labels at the
ends; the one conditional question: only if Engage or Entrust is not put in Not for HNW on 2.3) and how many
risk profiles 2.4a (`checklist` of six; only if 2.4 is shown), services 2.5 (+2.5a), who provides 2.6; 9.3a is gone. Every card sort has four piles of one size, Undo, and
Change on a pile. Answers are stored as `ceres-preview-v3:<id>`, so a v2 answer never fills a v3 question.
`t-blank.html` and `t-keep.html` are no longer used; they stay only so an old link lands on its step (each page sends a
step id to its own template). The first draft is frozen in `../preview-v1/`; v2 is in git history (`public/hnw/`).
`questionnaire/v3/patch-after-codex.py` landed after this preview work (15 Oct, evening): 2.4's new wording and ends,
2.4a as a checklist of six and the tenth conditional follow-up (`'2.4a'` is in `EXPECT.conditional` in both `nav.js`
copies), 2.4 conditional on 2.3, the investment specialist names and JPOI in 3.2, 5.4a and 7.2. The walk and the e2e
read 2.4 and 2.4a from `script.js`.

## Files

| File | What it is |
|---|---|
| `script.js` | `window.CERES_SCRIPT = { chapters, steps, templates, ui, context, sampleNote, version }`. Every step in play order, with all its copy and data |
| `nav.js` | `window.CeresNav`: step lookup, next/prev, page links, question numbers, rail dots, the reviewer's answers |
| `frame.js` | `window.CeresFrame` (the mockups' `rail` and `sheaf`, unchanged) and `window.CeresPreview.mount(step, opts)` |
| `preview.css` | `mockups/ceres-frame.css`, unchanged, plus a PREVIEW section (banner, frame height, Next hint, preview notes, shared bits) |
| `index.html` | The contents page (landing). The only page that scrolls, and only inside its list. A row shows the step's bridge before its question, as on the screen |
| `t-<template>.html` | One page per template. `?id=<step id>` picks the step |
| `shoot.mjs` | Screenshots and checks (scroll, clipping, console errors) at 1440x790, 1280x650 and 390x660 |

## Hard rules

- **Works from `file://` and over http.** Classic `<script src>` tags only. No ES modules, no `fetch`/XHR of local files,
  no build step, no libraries. Relative paths only. Google Fonts come in through `preview.css`.
- **Next always works.** Never disable the Next button. When the answer is incomplete, call
  `ui.status(false, '<the survey's own label>')`; the frame prints "In the survey: Sort 7 more" beside Next (inside
  the button on a phone). When complete, `ui.status(true)`.
- **Every follow-up is shown**, conditional ones too. The frame prints `step.previewCondition` as a grey italic preview
  note; you don't.
- **Nothing is sent or saved to a server.** Answers go to `localStorage` through `ui.save()` only.
- **No market anywhere on screen.** No chip, no picker, no city preset.
- **The context note** ("HNW client: $5-20mm liquid net worth") is added by the frame as the first grey line under the
  instruction, on every question and follow-up. Never put it in `notes` or draw it yourself, except on pages that draw
  their own band (`band: false`), where you print `CERES_SCRIPT.context` with class `c-note ctx`.
- **Fit.** No page scroll and no clipped content at 1440x790, 1280x650 and 390x660. The two declared phone exceptions
  (the ledger 5.1-5.2 and the sources list 5.4a) may scroll on a phone only, to keep the focused row above the keyboard.
  With the keyboard down they fit too.
- **No console errors or warnings** on load or while playing. Keep `<link rel="icon" href="data:,">` in the head, or every page logs a favicon 404 over http.
- **Strings come from `step` / `step.data` / `CERES_SCRIPT.ui`**, never typed into the page. If a string you need is
  missing, add it to `script.js` with its deck source; don't invent copy.

## A template page, start to finish

```html
<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Ceres preview</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="preview.css">
<script src="script.js"></script>
<script src="nav.js"></script>
<script src="frame.js"></script>
<style>
  /* page CSS ported from the mockup; the shared frame stays untouched */
</style>
</head>
<body>
<script>
(function () {
  'use strict'
  const step = CeresNav.current()                       // ?id= from the URL (first step if missing or unknown)
  if (step.template !== 'piles') { CeresNav.go(step.id); return }   // wrong page for this id: send it to its own
  const ui = CeresPreview.mount(step, { /* stage: true for the stage frame */ })
  const D = step.data

  // 1. draw the object into ui.obj from D (cards, piles, options ...); restore the reviewer's own answer if any
  const saved = ui.load()                                // undefined the first time

  // 2. on every change: store the answer and report completeness in the survey's own words
  function changed(answer, left) {
    ui.save(answer)
    if (left === 0) ui.status(true)
    else ui.status(false, CeresNav.fill(D.ui.missing, { n: left }))   // "Sort 7 more"
  }
})()
</script>
</body>
</html>
```

The frame wires Next and Back to the next and previous step in play order (`CeresNav.next/prev`), and handles the
keyboard: Enter with nothing focused (or on Next) goes on; Alt+→ and Alt+← go forward and back (outside text fields,
where Alt+arrow moves by word). A text field that should act on Enter (the plaque) calls `ui.goNext()` itself.

### `CeresPreview.mount(step, opts)` → `ui`

Builds, inside `<body>`: the preview banner ("Review preview · Next always works · nothing is saved", then the step id,
a "Wave 1 only" chip on sensitive steps, and the origin chip such as "Adam · email; 2:20-2:50, 4:12; Haresh" or
"Added"), then `.c-page > .c-frame` with the rail, the question band, the object container and the Next bar.

| opts | Default | Meaning |
|---|---|---|
| `stage` | `step.stage` | The stage frame: band in `.c-side`, object in `.c-stage` (3.1, 3.3, 9.1, 5.1-5.2, 8.1, 8.1a, 10.5; and, set by their pages, 2.3 and 5.4a) |
| `band` | true for question, followup, statement | false: no band; draw your own (welcome, breaks, pause, ending) |
| `objClass` | | Extra class on the object container (`.c-obj`, or `.c-stage` on the stage frame) |
| `vars` | | Extra placeholder values, merged over `CeresNav.resolveVars(step)` |
| `next` | `step.next` | Next label once complete; `false` for no Next (the ending) |
| `later` | false | Adds "Continue later" on the left of the bar (breaks, pause); it shows the survey's toast |
| `noBack`, `noChapter`, `hideSheaf` | false | Rail options |

The rail: Back (hidden on the first step); chapter numeral and name; one dot per question screen in the chapter, with a
sub-dot on follow-ups; "Question n of 42" on questions and follow-ups (the follow-up shares its parent's number); the
sheaf with one stalk per chapter reached; a Contents link to `index.html`. The survey's "about N min left" and "Saved ✓"
are left out of the preview rail on purpose (nothing is saved; reviewers navigate by number). Their strings are in
`CERES_SCRIPT.ui`.

The band, in order: bridge (`c-bridge`, its words in one span so a no-break "J.P. Morgan" stays in the line), question (`c-q`; screen-reader only when `step.questionIsObject`), instruction
(`c-i`), context note (`c-note ctx`), each of `step.notes` (`c-note`), then one grey italic preview note (`pv-note`)
holding `previewCondition`, `previewNote` and, when a `[X]` came from a sample, `CERES_SCRIPT.sampleNote`. `[X]` and
`{n}` in the question, instruction and notes are filled from `ui.vars`; the preview note is never filled (it explains
the placeholders).

| ui | |
|---|---|
| `ui.step`, `ui.frame`, `ui.rail`, `ui.band`, `ui.side`, `ui.obj`, `ui.bar`, `ui.left`, `ui.next`, `ui.back` | Elements. Draw the object into `ui.obj`; `ui.left` is the bar's left slot (links) |
| `ui.vars` | Resolved placeholders, e.g. `{ X: '6.0' }` on 5.2 |
| `ui.setBand({ bridge, question, instruction, notes, questionIsObject })` | Re-draw the band for an internal step (3.1's three steps, 10.5's quote). Pass only what changes |
| `ui.status(complete, missing)` | See the hard rules. `missing` falls back to `step.rule` |
| `ui.label(text)` | Change the Next label (10.4: "Skip" while empty). No argument restores `step.next`. Never set `ui.next.textContent` yourself |
| `ui.onNext(fn)`, `ui.onBack(fn)` | `fn()` returns `true` to consume the click (advance an internal step); anything else lets the frame navigate |
| `ui.goNext()`, `ui.goBack()` | Programmatic Next/Back (runs your handler first) |
| `ui.save(value)`, `ui.load()` | The reviewer's answer for this step (localStorage, key `ceres-preview-v3:<id>`) |
| `ui.previewNote(text)` | Adds a line to the preview note (e.g. that sample cards stand in) |
| `ui.toast(text)`, `ui.addLater(label, toast)` | The frame's toast; a "Continue later" link |
| `ui.esc`, `ui.glue`, `ui.earSVG` | HTML escape; escape plus no-break on "$5-20mm", "J.P. Morgan", "liquid net worth"; the wheat ear |

### `CeresNav`

`steps`, `chapters`, `step(id)`, `next(id)`, `prev(id)`, `href(step|id)` → `'t-<template>.html?id=<id>'`, `go(id)`,
`currentId()`, `current()`, `number(step)`, `chapter(step)`, `dots(step)` → `{ total, on, sub }`, `done(step)` (ripe
stalks), `answers.get/set/clear/clearAll/all`, `value(id)` → `{ value, sample }`, `resolveVars(step)`,
`fill(text, vars)`, `selfCheck()` (42 questions, 21 follow-ups, 10 breaks, 77 steps; the 10 conditional follow-ups
2.2a 2.4a 2.5a 4.3a 5.4a 6.2a 6.3a 7.2a 8.1a 8.4a; a mismatch logs a console warning), `total` (42). `resolveVars` prints a
whole number of 1,000 or more with the thousands comma ("3,000").

### Answers and dynamic follow-ups

Each page saves the reviewer's answer under its own step id, in the shape below. A follow-up reads its parent with
`CeresNav.value(parentId)`: it returns the reviewer's answer, or the parent's `data.sample` with `sample: true` when the
parent wasn't played (or was cleared). When a sample stands in, say so with `ui.previewNote(CERES_SCRIPT.sampleNote)`.

If the reviewer's own answer would not make the follow-up fire in the survey (for example 2 cards in Critical), the
preview still shows it: use the sample instead, and say why in one line, e.g. `ui.previewNote('Your Critical pile has 2
cards, so this would not show in the survey. Sample cards stand in.')`.

| Template | Saved value |
|---|---|
| blank, keep | (no v3 step) |
| piles | `{ [cardId]: 'not-hnw' \| 'nice' \| 'core' \| 'critical' }`, keys in the order the cards were placed (v3: Undo takes back the last) |
| configure | `{ execute: { belongs, covers: [], who }, engage: {...}, entrust: {...} }`; Not for HNW saves `{ belongs: 'not-hnw', covers: [], who: null }` |
| podium | `[id1, id2, id3]`, 1st first |
| trays | `{ [tileId]: trayId }` |
| ladder | `{ base, banking, mortgage, retirement, insurance, alternatives, four }` (percent levels) |
| rank | `[id, ...]`, rank 1 first (all ten when complete) |
| sentence | `{ [slotId]: number, [chipSlotId]: chipId }`; 4.2's opt-out saves `'never'`; 4.3a saves `{ [roleId]: number }` |
| checklist | `'id'` (one, and the trade-offs 1.1-1.4); `['id', 'id']` (two); `{ region, market }` (region-market; `market` is the typed text for Another market) |
| stamp | `{ [cardId]: stampId }`; 8.1a (`mode: 'pick-line'`) saves `'cardId'` |
| allocate-ledger | 5.1 `{ split, [rowId]: number }`; 5.2 `{ [rowId]: number }` ($mm) |
| allocate-list | `{ [rowId]: number }` (5.4a: whole per cent) |
| track | `'stopId'` (7.1 saves the number, e.g. `60`) |
| bottle | `{ md, ed, vp, associate }` |
| text | `{ [fieldId]: string }` (2.1: `{ r1, r2, r3 }`) |
| newspaper | `{ headline, quote }` |

Where a follow-up's options come from (`optionsFrom`):

| Step | Reads | Rule |
|---|---|---|
| 2.2a, 2.5a, 6.3a, 7.2a | `{ step, pile: 'critical' }` | The parent's Critical cards, in pile order. Up to 8: a podium of compact tiles; above 8 (`aboveMax: 'fan'`): the fanned pile, tap 1, 2, 3 |
| 2.3 (part 2) | `parts[1].optionsFrom: { step: '2.2', excludePile: 'not-hnw' }` | Only the products not put in Not for HNW on 2.2 (its sample if unplayed); none left: the part says so and counts as done |
| 2.6 | `tilesFrom: { step: '2.2', excludePile: 'not-hnw' }` | Every tile not put in Not for HNW on 2.2, plus tiles with `always: true` |
| 4.3a | `rowsFrom: { step: '4.3', stamp: 'above', roles }` | One row per role stamped "above", in card order; `sampleRoles` if none |
| 4.1a, 5.2, 5.4a, 8.1 | `data.vars` | `[X]` from 4.1's `mm`, or 10 minus 5.1's `split`; `[N]` from 5.4's `n` (5.4a: 0 would not fire it, so the sample stands in with a note); `{ value }` is a constant (8.1's `{n}`). The frame resolves them |
| 6.2a | `previewCondition` | Fires if either number on 6.2 (`first`, `after`) is 1 or more; both 0: a preview note says it would not show |
| 4.2 | check `ceiling-below-floor` | `mm / (3.1 base / 100) <= 4.1 mm` shows the soft check; no numbers shown |
| 8.1a | `{ step: '8.1', stamps: ['do', 'pilot'] }` | Lines stamped Do it or Pilot it stay live (Do it first on a phone) |
| 9.2 | `cards` | The ten 9.1 blocks, reshuffled (`seed`) |
| end | `top3From: '9.1'` | The first three of the reviewer's 9.1 order, else `sampleTop3` |

## Step fields (every step)

`id`, `kind`, `template`, `chapter` (numeral or null), `parent` (follow-ups), `title` (short, from v3 §3), `origin`
('Adam' \| 'Haresh' \| 'Added'), `originText` (the v3 §3 citation), `min` (planning minutes), `sensitive` (wave 1 only),
`stage` (stage frame), `bridge`, `question`, `instruction`, `notes[]`, `questionIsObject`, `previewCondition`,
`previewNote`, `rule` (completion rule, plain words), `next` (label when complete), `data`.

Common `data` keys: `store` (the design's store name), `shuffle` (seeded shuffle; `seed` where given), `missing` (the
survey's own Next label while incomplete, `{n}` filled by you), `sample` (a plausible answer used when a later step
needs this one), `ui` (shared interface lines).

## Data by template, with an example each

### flow (`t-flow.html`) · W, 0.1, pause, end
`data.variant` picks the drawing: `'welcome'` (`wordmark`, `nameLine`, `body[]`, `best`, `start`, `privacy { link,
title, text, close }`, `resume` listed only), `'statement'` (0.1: band from `question`/`instruction`/`notes`, no context
note; `ruler { marker, zones { lo, hnw, hi }, ticks[4], aria }`), `'pause'` (`line`, `later`, `toast`), `'ending'`
(`wreathLabel`, `thanks`, `sent`, `contact`, `sendFailure`, `top3From`, `sampleTop3`).
```js
{ variant: 'pause', line: "All that's left is a newspaper front page.", later: 'Continue later', toast: 'Saved. Open the same link to continue on any device.' }
```

### break (`t-break.html`) · break-I ... break-X
Reads the chapter from `CeresNav.chapter(step)`: `{ numeral, name, line, minutes, dots, lineWave2? }`; map states and
minutes from `CERES_SCRIPT.ui`. The map lines link to each break (preview only).

### blank (`t-blank.html`, port the plaque from `mockups/index.html`) · no v3 step (v2's 1.1, 1.2)
```js
{ store: 'instinctCritical', pre: 'The product or service most critical to winning is', post: '.', flash: 'One word.', missing: 'Type one word', minLetters: 2, maxChars: 24, sample: 'advice' }
```
`post: '.'` means the full stop rides with the slot. `questionIsObject` is set: mount with `band: false` (as the mockup
does: the sentence is on the plaque, the instruction and context note sit under it) and print the question in an
`.sr` heading.

### keep (`t-keep.html`, from `mockups/index.html`) · no v3 step (v2's keep)
```js
{ heading: 'Your two words.', hint: 'Tap the word you want to change.', change: 'Change a word', keep: 'Keep my words', kept: 'Kept as you wrote them.', srSuffix: 'Change this word.', from: ['1.1', '1.2'], sample: ['advice', 'distant'] }
```
v2: keep sits straight after the two plaques, before the trade-offs 1.3-1.6. Words come from the plaques' saved `word`
(sample per slot if missing); two or three words get larger plaques. "Change a word" then a tap goes to that plaque's
page (Next and Back there return to keep). Once kept, the preview note says Back cannot reach these two words.

### piles (`t-piles.html`, from `mockups/piles.html`) · 2.2, 2.5, 6.3, 7.2
```js
{ store: 'products', shuffle: true, seed: 2240, keys: '1-4', followup: '2.2a',
  piles: [{ id: 'not-hnw', label: 'Not for HNW', gloss: "We wouldn't offer it to these clients" }, ...],
  ui: { fanHint: 'Tap a card to sort it again.', fanClose: 'Close', fanCardAria: '{card}. Tap to sort it again.', doneCap: 'Cards sorted', doneLine: 'Tap a pile to see or change it.', missing: 'Sort {n} more', undo: 'Undo', change: 'Change' },
  cards: [{ id: 'securities', label: 'Shares and bonds', hint: 'Bought directly, in any market' }, ...],
  sample: { securities: 'critical', funds: 'core', ... } }
```
Fan head: `{pile} ({n}) · {fanHint} · {fanClose}`. 6.3 uses the banker glosses. v2: 2.5's cards carry `group`
("Specialist resources" and so on), printed as a small eyebrow above the label; 7.2 has a top 3 (`followup: '7.2a'`).
On a laptop every sort takes the size 2.2's taller band (two notes) needs; a band taller still steps the card and the
trays down once more (`t1`) until the piles clear Next.
v3 (Adam: changing a card was hard): the four piles are one size; Not for HNW keeps only a light grey tint. **Undo**
(`ui.undo`) sits beside the card from the first card sorted; it puts the last sorted card back on top of the deck and
takes it out of the answer (Z or Backspace on a laptop, its key shown on the button; Cmd or Ctrl+Z too). **Change**
(`ui.change`) shows on every pile that holds cards and opens it (the fan); a card tapped in the fan goes back on top of
the deck. While cards are left, a tap on a pile sorts the card (the instruction says so), so Change is how a pile
opens; once every card is sorted, a tap anywhere on a pile opens it. (This wins over the brief's "the whole pile opens
the fan": a pile that opened on a tap could no longer take a card, and "Tap a pile for each card" would stop being
true.) On a phone each chip has a box on its left: the count, which becomes the Change button once the pile holds
cards (the rest of the chip still takes the card); Undo sits at the card's foot, beside it.
After the reviewers' pass: the card is sorted and the answer stored the moment a pile is chosen (the flight only draws
it), so Next, Back or Contents pressed mid-flight keep it, and taps queued behind it are sorted then too. On a laptop
the card and the trays keep one size from sort to sort (see above). The stack starts below Change (a smaller Change at
1280x650, and a top card's label kept to two lines there), so the button never covers a card. Not for HNW's tint is
`#E5E3DF`, a grey that shows against the marble (also on 2.3's pile and the phone's chip). Card labels are
line-balanced.

### podium (`t-podium.html`, port the podium and fan pick from `mockups/piles.html`) · 3.2, 2.2a, 2.5a, 6.3a, 7.2a
```js
// 3.2: its own ten options
{ store: 'whyUs', compact: true, shuffle: true, hints: true, options: [{ id: 'alternatives', label: 'Access to alternatives', hint: 'Private markets and hedge funds' }, ...], sample: ['banker', 'alternatives', 'safety'],
  ui: { ranks: ['1st', '2nd', '3rd'], slot: '{rank} goes here', full: 'The podium is full. Tap the card this one should replace.', ariaPlaced: '{card}, {rank}. Tap to remove.', ariaReplace: 'Tap to replace it.', missing: ['Pick 3', 'Pick {n} more'] } }
// 2.2a: options from the parent's Critical pile (labels from the parent's cards)
{ store: 'productsTop3', compact: true, maxPodium: 8, optionsFrom: { step: '2.2', pile: 'critical' }, aboveMax: 'fan', ui: { ... } }
```

A restored answer is filtered to the cards offered now, and that cleaned answer is stored once on load (as 2.3 does);
the preview's podium/fan switch never saves.

### trays (`t-trays.html`) · 2.6, 5.3
```js
{ store: 'provide', shuffle: true, missing: 'Place {n} more',
  trays: [{ id: 'pb', label: 'Build it in the Private Bank' }, { id: 'jpm', label: 'Another J.P. Morgan business' }, { id: 'partner', label: 'An outside partner' }, { id: 'none', label: 'Not necessary to provide' }],
  tiles: [{ id: 'banking', label: 'Everyday banking' }, ..., { id: 'business-banking', label: "Banking for the client's company", always: true }],
  tilesFrom: { step: '2.2', excludePile: 'not-hnw' } }
```
2.6's instruction has `{n}`: pass `vars: { n: tiles.length }` to `mount`. Design: the trays side by side with a count
each (2.6 has four, 5.3 three); tap a tile then a tray, or drag; on a phone the tiles sit in a two-column chip grid
under the trays, and four trays sit two by two, each row taking the height in proportion to what it holds. A restored
tile no longer offered (2.6: its product since put in Not for HNW on 2.2) leaves the stored answer on load.

### ladder (`t-ladder.html`, from `mockups/wallet.html`; stage) · 3.1
```js
{ store: 'wallet', client: 10, snap: 5, rowStep: 5,
  steps: [{ bridge: '', question: "A typical $10mm client chooses us. ...", instruction: 'Tap the column or type a percentage.', notes: ['Count only their cash and investments.'], missing: 'Set a share' }, { ... 'Set {n} more' }, { ... 'Set one share for all four' }],
  rows: [{ id: 'banking', label: 'Everyday banking', short: 'Banking', hint: 'Current account, cards, payments', four: true }, ...],
  ui: { readout: '{p}% · ${m}mm of $10mm', rangeError: 'From 0% to 100%', todayTab: 'Today · {p}%', rowChip: 'No change', rowRangeError: 'From {base}% to 100%', step3Label: 'All four together', check: 'Your share for all four is lower than for [{row}] alone. Is that what you meant?' },
  sample: { base: 40, ... } }
```
Three internal steps: `ui.onNext` advances the step and calls `ui.setBand(steps[k])`; `ui.onBack` goes back a step.
Next always works, including past an unset step. In the check, `[{row}]` means the row's name replaces the brackets.

### rank (`t-rank.html`, from `mockups/rank.html`; stage) · 3.3, 9.1
```js
{ store: 'win', shuffle: true, blocks: [{ id: 'talent', label: 'Talent', hint: 'The right bankers and specialists' }, ...], sample: [...ten ids],
  ui: { trayHead: 'To place', ladderHead: 'Your order', clear: 'Clear all', trayDone: 'All ten are placed.', holdLine: 'Move it with ↑ ↓, or tap an empty place. Tap its number to remove it.', phoneToast: 'Number {n} cleared · Undo', missing: 'Place {n} more' } }
```

### sentence (`t-sentence.html`) · 4.1, 4.2, 4.3a, 6.1a, 6.2, 6.4a, 7.4a, 9.4
```js
{ store: 'ceiling',
  rows: [{ parts: ['At ', { slot: 'number', id: 'mm', prefix: '$', suffix: 'mm', min: 1, max: 200, step: 5, decimals: 1, typeStep: 0.5 }, ' in balances with us, I would ',
                   { slot: 'chips', id: 'verb', options: [{ id: 'offer', label: 'offer' }, { id: 'suggest', label: 'suggest' }, { id: 'require', label: 'require' }] }, ' a move to UHNW coverage.'] }],
  optOut: { id: 'never', label: 'Never. UHNW specialists join their team instead' },
  checks: [{ when: { custom: 'ceiling-below-floor', wallet: '3.1', floor: '4.1' }, text: 'Some clients with that much at J.P. Morgan could still be below where you said HNW starts.' }],
  sample: { mm: 15, verb: 'suggest' } }
```
`parts` is the sentence: strings and slots. Number slot: `prefix`/`suffix` sit around the box, `min`/`max` the range,
`step` the − / + steppers (none if absent), `decimals` what typing accepts, `wide` for six digits. Checks are soft (one
grey line, Next still works): `{ slot, gt }`, `{ slot, lt, orGt }`, or `custom`. `[N]` in a check is the typed number.
4.3a builds its rows from `rowsFrom` with `rowParts` (`{ slot: 'role' }` prints `roleWords[roleId]`; a number slot id
of `'{role}'` becomes the role id). Many rows that still do not fit at the smallest type close up (`.tight`: tighter
rows and padding), so all five roles fit a phone. v3: each role's words carry their own article ("a dedicated banker", "an
investment specialist resource"), so a row reads "From $[ ]mm, a client gets an investment specialist resource." On `questionIsObject` screens (4.1, 4.2, 5.4, 6.2, 9.4) the sentence is the
question. v2: 5.4 is one wide number (its check prints `[N]` with the thousands comma); 6.2 has two number slots in one
row (`first`, `after`). A hyphenated word ("in-person") stays on one line.
Design: Bodoni Moda 34 px on laptop, 22 px on phone, across a marble panel; boxes start empty.

### checklist (`t-checklist.html`, list look from the 5.2a list in `mockups/ledger.html`) · 1.1, 1.2, 1.3, 1.4, 2.4a, 4.1a, 4.4, 5.2a, 5.3a, 6.1, 6.2a, 8.2, 8.2a, 8.4, 9.3, 9.4b
```js
{ store: 'venues', mode: 'two', min: 1, max: 2, shuffle: true, pictures: true,
  options: [{ id: 'jpm-office', label: 'A J.P. Morgan office', picture: 'doorway' }, ...] }
{ store: 'comp2', mode: 'one', options: [..., { id: 'dont-know', label: "I don't know it well enough", pinned: true }], fallback: { bridge, question, options } }
{ store: 'launchFirst', mode: 'region-market', regions: [{ id: 'asia', label: 'Asia', markets: ['Hong Kong', ...] }, ...], other: { id: 'other', label: 'Another market', pinned: true, field: { limit: 40 } } }
```
`mode`: `'one'` (tap one), `'two'` (pick one or two), `'region-market'` (a region, then a market in it, on one screen).
`pictures` (6.1 in a row of four; 6.2a): engraved line pictures named by `picture` (descriptions in script.js
comments); until drawn, a labelled tile is fine. `places: true` (5.3a) allows 8 options. `pinned` sits last. 8.2a's
`fallback` is listed for review only (used if Comp 2.0 may not be named): it could be shown as a grey preview line.
`tradeoff: true` (1.1-1.4, `mode: 'one'`, `layout: 'row'`, two options): two large cards side by side (on a phone
too), hints shown; the pair swaps sides at random on each page load (`shuffle`, per person in the survey). The question
is a sentence with a blank (`________`): the pick is written into it, first letter in lower case ("The core of a
$5-20mm relationship is a plan for the family's goals."), and the cards hold still while the sentence grows.

### stamp (`t-stamp.html`) · 4.3, 7.4, 8.1, 8.1a, 8.3, 9.2
```js
{ store: 'entitled', skin: 'plain', shuffle: true, missing: 'Stamp {n} more', followup: '4.3a',
  stamps: [{ id: 'every', label: 'Every HNW client', impression: 'EVERY', glyph: 'tick' }, { id: 'above', label: 'Only above an amount', impression: 'ONLY ABOVE', glyph: 'step' }, { id: 'none', label: 'No HNW client', impression: 'NONE', glyph: 'cross' }],
  cards: [{ id: 'banker', label: 'A dedicated banker of their own', hint: 'One named banker', role: true }, ...] }
```
`skin`: `'plain'`, `'ai'` (7.4: four olive stamps, `timeline: true`, fixed order, no glyphs), `'tariff'` (8.1 on the
stage frame: `tariffHeader`, the printed card with margin boxes), `'readiness'` (9.2: impressions print into a square
grade box). Glyphs: tick, cross, step (two stairs), half (half-filled circle), flag (pennant). 8.1a is `mode:
'pick-line'`: the tariff card again, lines stamped Do it or Pilot it (from 8.1's answer or sample) live, the rest grey;
phone: chips with `phoneTags`. 8.1's `{n}` is 12 (a constant in `data.vars`, so the frame fills it); the `price-list` card is `sensitive`.

### allocate-ledger (`t-allocate-ledger.html`, from `mockups/ledger.html`; stage) · 5.1, 5.2
```js
{ store: 'ledgerCash', phase: 'cash', rows: [{ id: 'jpm', label: 'J.P. Morgan' }, ...], shuffle: true, jpmNeverFirst: true,
  ui: { header: 'THE TYPICAL CLIENT · $10,000,000', rowHead: 'Held by', totalHead: 'Row total', columns: { cash: 'Banking and cash', inv: 'Investments' }, invHeader: 'Investments: shares, bonds, funds, alternatives, structured products',
        sub: { first: 'type the split first', toPlace: '{x} to place', placed: '{x} placed', nothing: 'nothing to place', nextScreen: 'next screen', locked: 'locked', phone: 'of {x}' }, running: 'Banking and cash: {placed} of {target} · {left} left', over: '{x} too much' },
  split: { parts: ['Of their $10mm, $', { slot: 'number', id: 'split', min: 0, max: 10, decimals: 1 }, 'mm is in banking and cash. The rest is invested.'] },
  status: { noSplit: 'Type the split above to open the Banking and cash column.', zero: 'Nothing in banking and cash.' },
  missing: { noSplit: 'Type the split', left: '{x} left to place', over: '{x} too much' }, step: 0.5, typeStep: 0.1, sample: { split: 4, ... } }
```
5.2 (`phase: 'inv'`) shows 5.1's column inked and locked (`cashFrom: '5.1'`, sample if unplayed) and counts toward
`$[X]mm` (`ui.vars.X`); `status.none` when the split was 10. 5.2a is a separate checklist page in the preview.

### allocate-list (`t-allocate-list.html`; stage) · 5.4a
```js
{ store: 'sources', shuffle: true, total: 100, unit: '%', step: 5, footer: '{n}% of 100% placed · {c} of [N] clients',
  vars: { N: { from: '5.4', key: 'n', sample: 3000, format: 'number' } },
  rows: [{ id: 'existing', label: 'Clients we already have', hint: '$5-20mm clients with the IPB today', pinned: true }, { id: 'xlob', label: 'Referrals from other J.P. Morgan businesses', hint: 'X-LOB: the CIB, Workplace, ICB (Chase UK), Personal Investing' }, ...] }
```
Shares of 100% (`unit: '%'`). `[N]` is 5.4's number; `{c}` in the footer is round(placed% x N / 100), and each row
shows its own share as clients beside the box (laptop). The `pinned` row stays first; the rest shuffle. Footer forest
green at exactly 100, amber over. On the stage frame (band in the side column), so nine rows fit 1280x650. The deck
gives no Next label for this screen; use `step.rule`.

### track (`t-track.html`) · 2.4, 6.2b, 7.1, 7.3, 8.4a, 8.4b, 9.4a
```js
{ store: 'aiLevel', missing: 'Tap one', stops: [{ id: 'hardly', label: 'Hardly at all', hint: 'Search and spell-check' }, ...] }
{ store: 'digitalShare', numeric: true, min: 0, max: 100, step: 10, stops: [{ id: '0', label: '0%' }, ...], readout: '{a}% app and web · {b}% with a banker', ends: ['App and web', 'With a banker'] }
```
Nothing chosen until the first tap; stops left to right in the given order. `labelsUnder` (8.4b) puts the labels under
the stops. `ends` name the two ends of the scale, on a word scale too (v3, 2.4: "Easier to run at scale" on the left,
"More choice for the client" on the right): above the line on a laptop; on a phone's vertical line, above the first
stop and below the last. The readout keeps the height of its longest answer, and the stops the height of a chosen
(bold) label, so a tap never moves the line (v3: before, 2.4's two-line stop at 1280x650, and 8.4b's long labels,
pushed the stops into Next). Before the first tap the readout is an empty slot (a faint dashed edge, no dash). On a
phone's vertical line a stop is never shorter than its words (a two-line hint pushes its own row, not the end label),
and the fit's later steps tighten the stops there too (`.tk.vert.d2`: smaller type; `.d3`: less padding).

### bottle (`t-bottle.html`) · 6.4
```js
{ store: 'seniority', total: 10, counter: '{left} of 10 bankers left', missing: 'Add {n} more', jugs: [{ id: 'md', label: 'Managing Director' }, { id: 'ed', label: 'Executive Director' }, { id: 'vp', label: 'Vice President' }, { id: 'associate', label: 'Associate' }] }
```

### text (`t-text.html`) · 2.1, 10.1, 10.2, 10.3, 10.4
```js
{ store: 'feel', counterFrom: 0.8, phoneNext: 'Next note', fields: [{ id: 'excited', stem: 'What excites me most is…', limit: 280, required: true, min: 3 }, { id: 'nervous', stem: 'What makes me most nervous is…', limit: 280, required: true, min: 3 }] }
{ store: 'rival', sentence: { pre: 'The competitor that does this best is', post: '.', field: 'name' }, fields: [{ id: 'name', kind: 'line', inSentence: true, limit: 60, required: true }, { id: 'why', stem: "What they do that we don't is…", limit: 200, required: false }], chip: { label: 'No one does it well', fills: 'name', value: 'no one' }, typeaheadAfter: 2, typeahead: { asia: [...], emea: [...], latam: [...] } }
{ store: 'last', optional: true, emptyLabel: 'Skip', fields: [{ id: 'last', limit: 400, required: false }] }
```
Stems sit above each ruled field; a counter shows from `counterFrom` of the limit. 10.4: `ui.label('Skip')` while
empty, `ui.label()` once typed. The preview has no respondent region: merge the three type-ahead lists. v3: 10.3's
chip writes `chip.value` ('no one') in the blank, not its label, so the sentence reads "...does this best is no one."
v3, 2.1 (`skin: 'quotes'`, Adam's question): `{ store: 'drewThem', skin: 'quotes', counterFrom: 0, phoneNext: 'Next
reason', counter: '{n} left', fields: [{ id: 'r1', stem: '1.', limit: 280, required: true, min: 3 }, ...] }`. Three
client quotes side by side on a laptop, on a wider frame (1100 px): each a card with a large Bodoni opening quote mark
(10.5's `marks[0]`; it turns from wheat to harvest gold once the quote has 3 characters), its number (the stem) and the
answer in Source Serif italic on faint rules; under it the count of what is left (`counter`, amber in the last tenth;
the field stops at the limit, typed or pasted). On a phone, one quote per view: "Next reason" under each but the last,
and the three numbers at the card's top to jump between them; Next and Back walk the quotes first, as 10.1's notes.
A long quote, or one written as short lines, sets the type of all three quotes a step smaller (`.f1`, `.f2`) until each
shows in full, first line included; on a phone the type stays at 16 px or more (smaller, a phone zooms in on the
field). Past the last step the field scrolls, and leaving it shows its first line again.

### newspaper (`t-newspaper.html`, from `mockups/newspaper.html`; stage) · 10.5
`steps[2]` (headline, then the quote once the headline has 10+ characters: `ui.setBand(steps[1])`), `labels { headline,
quote }`, `marks` (`['“', '”']`), `page { masthead, ears, folio, kicker, headlinePlaceholder, quotePlaceholder, byline,
footer }`, `limits { headline, quote }`, `counter`, `counterLong`, `missing { headline, headlineShort, quote, quoteShort }`.
v2: one fixed front page, "The Ledger", folio "Vol. I · No. 1 · Launch day", byline "— J.P. Morgan Private Bank"; no
city paper to choose and no name or title fields. Enter in the quote goes on. `step.next` is "Send"; Send goes to the
ending.

### configure (`t-configure.html`; stage) · 2.3
```js
{ store: 'investWays',
  items: [{ id: 'execute', label: 'Execute', hint: 'Brokerage: the client decides, we place the trade' }, { id: 'engage', ... }, { id: 'entrust', ... }],
  parts: [
    { id: 'belongs', head: 'Where it belongs', question: 'Where does it belong in our offer?', mode: 'one', options: PILES_OFFER },
    { id: 'covers', head: 'Products it covers', question: 'Which products does it cover?', mode: 'any', optionsFrom: { step: '2.2', excludePile: 'not-hnw' }, options: [{ id: 'securities', label: 'Shares and bonds' }, ...], min: 1 },
    { id: 'who', head: 'Who the client deals with', question: 'Who does the client mainly deal with?', mode: 'one', options: [{ id: 'online', label: "No one, it's all online" }, { id: 'desk', label: 'An execution desk', only: ['execute'] }, ...] } ],
  skipRest: { part: 'belongs', on: 'not-hnw' },
  ui: { of: '({k} of {n})', skipped: 'Skipped: not for HNW', noneLeft: '...', missing: { belongs: 'Pick where it belongs', covers: 'Tick at least one product', who: 'Pick who they deal with' } },
  sample: { execute: { belongs: 'core', covers: ['securities', 'funds'], who: 'online' }, ... } }
```
One item at a time, like 3.1's steps: the template owns Next and Back between items ("Execute · Engage · Entrust (1 of
3)" above them; the names are tabs too, and a finished item gets a tick). Each item shows its hint and three numbered
parts: part 1 the four piles (name and gloss; the gloss becomes a tooltip when the fit needs the room), part 2 product
chips (tick any, at least one), part 3 one of the options whose `only` includes the item (or that have none), hints
shown. Not for HNW in part 1 greys parts 2 and 3 with `ui.skipped`. Part 2 offers only the products not put in Not
for HNW on 2.2 (`CeresNav.value('2.2')`, its sample when unplayed, with the sample note); if none are left it prints
`ui.noneLeft` and counts as done. v3: nine products (ESG and Thematic added) sit three by three. Next always works: the hint beside it is the first missing part's `ui.missing`
line; on the last item, an earlier unfinished item is named ("Execute: Pick where it belongs"). On the stage frame
the three parts show open; the fit tightens in steps (`.d0` spacing only, then `.d1`, `.d2`, `.d3`), and where they
still cannot fit (a phone) one part shows at a time and Next and Back walk the parts, then the items (Not for HNW
skips the other two parts). On a laptop a view counts as fitting only with 12 px of air under its last row, so the
last option never sits on Next's divider.

## Template pages expected

| Page | Step ids | Port from | Built here |
|---|---|---|---|
| `t-flow.html` | W, 0.1, pause, end | `mockups/index.html` | yes |
| `t-break.html` | break-I, break-II, break-III, break-IV, break-V, break-VI, break-VII, break-VIII, break-IX, break-X | `mockups/index.html` | yes |
| `t-blank.html` | none in v3 (v2's 1.1, 1.2) | `mockups/index.html` (plaque) | kept so an old link lands on its step |
| `t-keep.html` | none in v3 (v2's keep) | `mockups/index.html` (keep, seal) | kept so an old link lands on its step |
| `t-piles.html` | 2.2, 2.5, 6.3, 7.2 | `mockups/piles.html` | to build; v3: Undo, Change, piles of one size |
| `t-configure.html` | 2.3 | none (the piles' and the checklist's skin) | v2, built here |
| `t-podium.html` | 2.2a, 2.5a, 3.2, 6.3a, 7.2a | `mockups/piles.html` (podium, fan pick) | to build |
| `t-trays.html` | 2.6, 5.3 | design §4 | to build |
| `t-ladder.html` | 3.1 | `mockups/wallet.html` | to build |
| `t-rank.html` | 3.3, 9.1 | `mockups/rank.html` | to build |
| `t-sentence.html` | 4.1, 4.2, 4.3a, 5.4, 6.1a, 6.2, 6.4a, 7.4a, 9.4 | design §4 | to build |
| `t-checklist.html` | 1.1, 1.2, 1.3, 1.4, 2.4a, 4.1a, 4.4, 5.2a, 5.3a, 6.1, 6.2a, 8.2, 8.2a, 8.4, 9.3, 9.4b | `mockups/ledger.html` (5.2a list) | to build |
| `t-stamp.html` | 4.3, 7.4, 8.1, 8.1a, 8.3, 9.2 | design §4 | to build |
| `t-allocate-ledger.html` | 5.1, 5.2 | `mockups/ledger.html` | to build |
| `t-allocate-list.html` | 5.4a | `mockups/ledger.html` (cells, footer) | to build |
| `t-track.html` | 2.4, 6.2b, 7.1, 7.3, 8.4a, 8.4b, 9.4a | design §4 | to build; v3: end labels on a word scale |
| `t-bottle.html` | 6.4 | The Ascent's bottle | to build |
| `t-text.html` | 2.1, 10.1, 10.2, 10.3, 10.4 | design §4 | to build; v3: the quotes skin (2.1) |
| `t-newspaper.html` | 10.5 | `mockups/newspaper.html` | to build |

## Porting a mockup

- Keep the mockup's page CSS in the page's `<style>`, scoped to its own classes. Stage pages override the frame width
  and side column the way the mockup did (`.c-frame.stage { width: 1120px }`, `.c-frame.stage .c-body {
  grid-template-columns: 300px 1fr }`). Leave `.c-frame` height alone: `preview.css` sets it so the banner fits.
- The preview takes 20 px for the banner on laptops (18 px on a phone). The frame is `min(750px, 100dvh - 40px)` at
  1440x790 (750 px, as in the mockups) and `100dvh - 36px` at 1280x650 (614 px; the mockups had 610). On a phone the
  frame is 642 px tall instead of 660: the 18 px must come out of the object.
- Drop the mockup's own rail call (`CeresFrame.rail(...)`), band markup, `mock-tag`, `mock-index`, demo toggles and
  `window.__demo`; the frame draws the rail and band. Keep the object's interaction code as it is.
- Replace `next.disabled = ...; next.textContent = ...` with `ui.status(complete, label)`.
- Replace hard-coded strings with `step.data` ones.

## Testing

```
cd .context/ceres/preview
node shoot.mjs --out /tmp/pv 't-piles.html?id=2.2' 't-podium.html?id=2.2a'
node shoot.mjs --all --out /tmp/pv            # every step, every size
```

Each line reports `scrolls`, `clips` (content taller or wider than its frame region, which `overflow: hidden` would
hide) and `errors` (console errors and warnings, page errors, failed local requests). The exit code is 1 if anything
is off. The end-to-end walk, `node qa/walk.mjs` (from anywhere), plays every step forward at 1440x790, 1280x650 and
390x660, backward, and from `file://`, checking text, fit, Next and the console on every internal state, then the
extras (v3): the contents page lists the 77 steps and every link opens its step (keep and 9.3a gone); break I reads
"About 1 minute"; 2.1 takes three quotes that stop at 280; 2.2's piles are one size, Undo (click, Z, Backspace) puts
the last card back and out of the answer, Change opens a pile and a fan card goes back on top, and once all are sorted
a tap opens a pile; 2.2's Critical pile on 2.2a; a product put in Not for HNW on 2.2 missing from 2.3's part 2 (and
2.3's saved shape and skip); 2.4's end labels and stops, 2.4a's stops (or options) as `script.js` gives them; 1.1's
filled blank; 4.3a's rows and saved shape; and on a phone, 2.1's one quote per view, 2.4's ends, the chips' Change
boxes and Undo. After the reviewers' pass it also checks: full 2.1 quotes (short lines, long words) show in full at
all three sizes; Change clears a stack of 10 or 15 cards at 1440 and 1280; the four sorts share one card and tray
size; cards in the air survive an immediate Next; 2.2a and 2.6 store their cleaned answer on load; 2.3 keeps air above
Next with eight products; 2.4's readout is empty before a tap; the contents row of 2.1 carries its bridge; 4.3a with
five roles fits a phone.
`e2e/hnw-preview.mjs` in the repo walks the gated copy in `public/hnw/` the same way, with a few of the v3 checks. With
the keyboard down nothing scrolls, so both walks let off only 5.4a on a phone (v3: the ledger is held to fit too). Also
click through by hand: Next on an empty screen, Back, Alt+→ / Alt+←, then the follow-up with and without the parent
played, and once over http (`python3 -m http.server` in this folder).
