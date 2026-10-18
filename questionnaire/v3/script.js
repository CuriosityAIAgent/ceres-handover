/* Ceres review preview: the script. Every step a reviewer clicks through, in play order.
 *
 * Sources (11 Oct 2026; v2 after Chris's review, 13 Oct 2026; v3 after Adam's and Chris's notes, 15 Oct 2026):
 *   design   .context/ceres/design/ceres-design-v3.md  (v3, 10 Oct: §2 the experience, §3 play order, §4 every screen)
 *   copy     .context/ceres/copy/ceres-copy-deck.md     (10 Oct; its "after" column wins for every respondent string)
 *   mockups  .context/ceres/mockups/*.html               (QA'd 10 Oct; visual and interaction standard)
 *   review   .context/ceres/questionnaire/v2/review/chris-feedback.md (Chris, 13 Oct); every change is in
 *            .context/ceres/questionnaire/v2/CHANGE-SPEC.md and logged in changes.json next to this file
 *
 * Counts (v3; questionnaire/v3/build.mjs checks them, and so does the preview's CeresNav.selfCheck() on load):
 *   42 question screens  (I 4 · II 6 · III 3 · IV 4 · V 4 · VI 4 · VII 4 · VIII 4 · IX 4 · X 5)
 *   21 follow-ups        (11 always, 10 conditional: 2.2a 2.4a 2.5a 4.3a 5.4a 6.2a 6.3a 7.2a 8.1a 8.4a)
 *   1 conditional question: 2.4 (only if Engage or Entrust is offered on 2.3; a brokerage-only offer skips 2.4 and 2.4a)
 *   10 chapter breaks, plus welcome, 0.1 opening statement, the pause card and the ending
 *   77 steps in all
 *   Origins (42 screens): Adam 29 · Haresh 4 · Added 9. Follow-ups (21): Adam 6 · Haresh 1 · Added 14.
 *   Minutes (sum of each chapter's steps, rounded): I 1 · II 10 · III 5 · IV 3 · V 6 · VI 5 · VII 4 · VIII 5 · IX 4 · X 8 = 51
 *
 * Step fields
 *   id, kind ('welcome'|'statement'|'break'|'question'|'followup'|'keep'|'pause'|'ending'), template, chapter (numeral or
 *   null), parent (follow-ups), title (short, from §3), origin ('Adam'|'Haresh'|'Added'), originText (v3 §3 citation),
 *   min (planning minutes from §3; each follow-up carries its own, so sum every step), sensitive (dropped in wave 2),
 *   bridge, question, instruction, notes[] (never the context note; the frame adds it), questionIsObject (the sentence or
 *   plaque IS the question, so the band prints it for screen readers only), previewCondition (conditional follow-ups and 2.4,
 *   plain words), previewNote (where a list or a number comes from an earlier answer), rule (the survey's
 *   completion rule, plain words), next (the Next label once complete), data (everything the template needs; see
 *   CONTRACT.md).
 *   Document only (the Word questionnaire, not the screen): docHow (replaces the generated "How they answer" line),
 *   docPair (chapter I: the later question each answer is read against).
 *   v2 data keys: tradeoff (checklist, 1.3-1.6: a forced choice between two good things), card group (2.3: shown on the
 *   card, and as subheads in the document), items and parts (configure, 2.2: three ways of investing,
 *   three parts each), unit (5.4a: shares of 100% shown as clients of the 5.4 number).
 *   Placeholders: {n} is filled at load time; [X] and [N] are filled from earlier answers (data.vars) or the screen;
 *   {c} (5.4a's footer) is the typed share as clients of [N].
 */
(function () {
  'use strict'

  const CONTEXT = 'HNW client: $5-20mm liquid net worth'

  const chapters = [
    // minutes: the sum of each chapter's step `min`, rounded (v2; build.mjs warns if they drift)
    { numeral: 'I', name: 'First instinct', line: 'Four quick choices between two good options. Go with your first instinct.', minutes: 1, dots: 4 },
    { numeral: 'II', name: 'What we offer', line: 'First, why clients come to us. Then products, ways of investing and services, one at a time.', minutes: 10, dots: 6 },
    { numeral: 'III', name: 'Winning the client', line: "How much of a client's money could we win, and why would they move it to us?", minutes: 5, dots: 3 },
    { numeral: 'IV', name: 'Who gets what', line: 'Here you set where HNW starts and ends, and what each client gets.', minutes: 3, dots: 4 },
    { numeral: 'V', name: 'Where the money sits', line: 'Once a client chooses us, who holds their money? And where do new clients come from?', minutes: 6, dots: 4 },
    { numeral: 'VI', name: 'How we serve them', line: 'This one is about our bankers and how they can cover clients.', minutes: 5, dots: 4 },
    { numeral: 'VII', name: 'Digital and AI', line: 'How digital the offer can be, and how much AI can do.', minutes: 4, dots: 4 },
    { numeral: 'VIII', name: 'Price and pay', line: 'Pricing first, then how we pay bankers.', lineWave2: 'What we would charge $5-20mm clients.', minutes: 5, dots: 4 },
    { numeral: 'IX', name: 'What it takes to win', line: "You'll rank ten things we might need, then say how ready we are on each.", minutes: 4, dots: 4 },
    { numeral: 'X', name: 'Your view', line: 'A few questions in your own words. The last asks for a headline and a quote.', minutes: 8, dots: 5 },
  ]

  /* ------------------------------------------------------------------ shared lists */

  // The four "what matters" piles (2.1, 2.2's first part, 2.3, 7.2), always in this order.
  const PILES_OFFER = [
    { id: 'not-hnw', label: 'Not for HNW', gloss: "We wouldn't offer it to these clients" },
    { id: 'nice', label: 'Nice to have', gloss: 'Good, but we would win without it' },
    { id: 'core', label: 'Core', gloss: 'Every HNW client expects it' },
    { id: 'critical', label: 'Critical to winning', gloss: 'Why they would choose us' },
  ]
  // The same piles with the banker glosses (6.3).
  const PILES_BANKER = [
    { id: 'not-hnw', label: 'Not for HNW', gloss: 'Not needed in an HNW banker' },
    { id: 'nice', label: 'Nice to have', gloss: 'Good, but we would win without it' },
    { id: 'core', label: 'Core', gloss: 'Every HNW banker needs it' },
    { id: 'critical', label: 'Critical to winning', gloss: 'What sets the best HNW bankers apart' },
  ]
  // Interface lines shared by every pile sort (deck, "The piles").
  const PILE_UI = {
    fanHint: 'Tap a card to sort it again.',           // fan head: "{pile} ({n}) · Tap a card to sort it again. · Close"
    fanClose: 'Close',
    fanCardAria: '{card}. Tap to sort it again.',
    doneCap: 'Cards sorted',                           // done panel: "{n} · Cards sorted · Tap a pile to see or change it."
    doneLine: 'Tap a pile to see or change it.',
    missing: 'Sort {n} more',
    // v3 (Adam, 15 Oct: changing a card was hard): Undo, near the card, puts the last sorted card back on top of the
    // deck (Z or Backspace on a laptop); Change, on every pile that holds cards, opens the pile to sort a card again
    undo: 'Undo',
    change: 'Change',
  }
  // Interface lines shared by every podium (3.2, 2.1a, 2.3a, 6.3a, 7.2a).
  const PODIUM_UI = {
    ranks: ['1st', '2nd', '3rd'],
    slot: '{rank} goes here',
    full: 'The podium is full. Tap a card to swap it out.',
    ariaPlaced: '{card}, {rank}. Tap to remove.',
    ariaReplace: 'Tap to replace it.',
    missing: ['Pick 3', 'Pick {n} more'],               // nothing placed / some placed
  }
  const RANK_UI = {
    trayHead: 'To place',
    ladderHead: 'Your order',
    clear: 'Clear all',
    trayDone: 'All ten are placed.',
    holdLine: 'Move it with ↑ ↓, or tap an empty place. Tap its number to remove it.',
    phoneToast: 'Number {n} cleared · Undo',
    missing: 'Place {n} more',
  }
  // The stamps that repeat (8.1, 8.3).
  const STAMPS_DO = [
    { id: 'do', label: 'Do it', impression: 'DO IT', glyph: 'tick' },
    { id: 'pilot', label: 'Pilot it in one market first', impression: 'PILOT', glyph: 'flag' },
    { id: 'never', label: 'Never', impression: 'NEVER', glyph: 'cross' },
  ]
  // The ten blocks of 9.1, reused by 9.2 (same labels and hints, fresh shuffle).
  const WIN_BLOCKS = [
    { id: 'bandwidth', label: 'Management bandwidth to execute', origin: 'Adam' },
    { id: 'digital', label: 'Enhancements to the digital platform', origin: 'Adam' },
    { id: 'talent', label: 'Talent', hint: 'The right bankers and specialists', origin: 'Adam' },
    { id: 'training', label: 'A training programme', hint: 'Built for HNW bankers', origin: 'Adam' },
    { id: 'referrals', label: 'Referrals from other J.P. Morgan businesses', hint: 'The CIB, Workplace, Chase', origin: 'Added' },
    { id: 'pay', label: 'Pay designed for HNW', hint: 'Including credit for referrals', origin: 'Added' },
    { id: 'onboarding', label: 'Fast, simple account opening', origin: 'Added' },
    { id: 'pricing', label: 'Clear, competitive pricing', origin: 'Added' },
    { id: 'products', label: 'Products sized for HNW clients', hint: 'Lower minimums, lending, mortgages', origin: 'Added' },
    { id: 'service-model', label: 'A clear service model', hint: 'Who gets what, and from whom', origin: 'Added' },
  ]
  // The ledger rows (5.1 and 5.2), shuffled per person, J.P. Morgan never first.
  const LEDGER_ROWS = [
    { id: 'jpm', label: 'J.P. Morgan' },
    { id: 'champion', label: 'The national champion bank', hint: "Your market's leading local bank" },
    { id: 'global', label: 'Another bank', hint: 'Global, private or another local bank' },
    { id: 'independent', label: 'An independent adviser or family office', hint: 'Includes external asset managers' },
    { id: 'broker', label: 'An online broker', hint: 'Including trading apps' },
    { id: 'neobank', label: 'A digital bank', hint: 'A bank that is only an app' },
    { id: 'wrappers', label: 'Insurance and retirement wrappers', hint: 'Held through an insurer or pension provider' },
  ]
  const LEDGER_UI = {
    header: 'THE TYPICAL CLIENT · $10,000,000',
    rowHead: 'Held by',
    totalHead: 'Row total',
    columns: { cash: 'Banking and cash', inv: 'Investments' },
    invHeader: 'Investments: shares, bonds, funds, alternatives, structured products',
    sub: { first: 'type the split first', toPlace: '{x} to place', placed: '{x} placed', nothing: 'nothing to place', nextScreen: 'next screen', locked: 'locked', phone: 'of {x}' },
    running: 'Banking and cash: {placed} of {target} · {left} left',   // over target: "· {over} too much"
    over: '{x} too much',
    total: 'Total',                                                     // footer label (mockups/ledger.html; not in the deck)
  }
  const CTX_SAMPLE_NOTE = 'Sample answers stand in when the earlier screen was not played.'

  /* ------------------------------------------------------------------ the steps */

  const steps = [
    /* ============================== prologue */
    {
      id: 'W', kind: 'welcome', template: 'flow', chapter: null, title: 'Welcome',
      origin: 'Adam', originText: '15:16, 12:52', min: 0.8,
      next: 'Start', rule: null,
      data: {
        variant: 'welcome',
        wordmark: 'CERES',
        nameLine: 'Ceres was the Roman goddess of the harvest, which felt like the right name for growth we plan to build ourselves.',
        body: [
          "We're looking at how the IPB could serve clients with $5-20mm of liquid net worth. We'd like your honest view, including where you'd do things differently.",
          "Answer from your own experience; there's nothing to look up. Most screens are a quick tap or drag. A few ask you to write a sentence or two.",
          'Set aside 30 minutes to an hour.',
        ],
        best: '',   // Haresh, 11 Oct: no laptop/phone line
        start: 'Start',
        privacy: { link: 'Privacy', title: 'Privacy', text: 'Privacy notice text to come from J.P. Morgan privacy and HR.', close: 'Close' },
        // Not drawn in the preview; listed so the strings are reviewable in one place.
        resume: { heading: 'Welcome back.', line: 'You stopped in chapter VI · How we serve them. Your answers so far are saved.', button: 'Continue', twoDevices: 'This survey is open on another device. Continue here?' },
      },
    },
    {
      id: '0.1', kind: 'statement', template: 'flow', chapter: null, title: 'Opening statement',
      origin: 'Adam', originText: 'email, first lines', min: 0.4,
      question: 'This survey is about the opportunity to cover HNW clients, who have $5-20mm of liquid net worth.',
      instruction: 'Answer every question with these clients in mind.',
      notes: ['Liquid net worth is cash and investments they could move, not home or business.'],
      noContext: true,
      next: 'Next', rule: null,
      data: {
        variant: 'statement',
        ruler: {
          marker: 'The clients we mean',
          zones: { lo: 'Below $5mm', hnw: 'HNW: $5-20mm', hi: 'UHNW: $20mm and above' },
          ticks: ['$0', '$5mm', '$20mm', 'more'],
          aria: 'A scale of liquid net worth: below $5mm, HNW from $5mm to $20mm, and UHNW from $20mm. This survey is about the HNW clients.',
        },
      },
    },

    /* ============================== I · First instinct */
    { id: 'break-I', kind: 'break', template: 'break', chapter: 'I', title: 'Chapter break', origin: 'Added', originText: '§2.5 chapter breaks', min: 0.12, next: 'Next', rule: null, data: {} },
    // v3 (Adam, 15 Oct: the one-word answers were hard, especially describing J.P. Morgan in one word, and the survey
    // should not start with product and service): the two typed blanks and their keep step are gone. Chapter I is the
    // four forced choices between two good things (Chris, 13 Oct, comment 1). One tap each; the left/right order is
    // shuffled per person. Each names the later question it is read against (docPair).
    {
      id: '1.1', kind: 'question', template: 'checklist', chapter: 'I', title: 'The core: plan or advice',
      origin: 'Adam', originText: 'email, "All clients should have...as a core of their relationship"; a choice of two after Chris (13 Oct)', min: 0.25,
      question: 'The core of a $5-20mm relationship is ________.',
      instruction: "Both matter. Tap the one that's closer to your view.", notes: [],
      docPair: "Read against the wealth-plan and investment specialist cards in 2.5, and the 4.3 stamps for 'A written wealth plan, updated each year' and 'Specialist investment advice when they ask'.",
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'tradeCore', mode: 'one', shuffle: true, layout: 'row', tradeoff: true, missing: 'Tap one',
        // plan-led against advice-led. "Specialist investment advice" is Adam's own example of what every client should
        // have (6:05-6:10) and the 4.3 card label, so pair P13 reads against the 4.3 stamps again
        options: [
          { id: 'goals', label: "A plan for the family's goals" },
          { id: 'advice', label: 'Specialist investment advice' },
        ],
      },
    },
    {
      id: '1.2', kind: 'question', template: 'checklist', chapter: 'I', title: 'HNW clients most value ___: attention or speed',
      origin: 'Adam', originText: 'email; 3:56 (his sentence, word for word); a choice of two after Chris (13 Oct)', min: 0.25,
      question: 'HNW clients most value ________ in their banking providers.',
      instruction: "Both matter. Tap the one that's closer to your view.", notes: [],
      docPair: 'Read against 6.1, 6.2 and 7.1.',
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'tradeValue', mode: 'one', shuffle: true, layout: 'row', tradeoff: true, missing: 'Tap one',
        // each option completes Adam's sentence: "HNW clients most value personal attention in their banking providers."
        options: [
          { id: 'attention', label: 'Personal attention' },
          { id: 'speed', label: 'Speed and convenience' },
        ],
      },
    },
    {
      id: '1.3', kind: 'question', template: 'checklist', chapter: 'I', title: 'Why they choose us: name or banker',
      origin: 'Adam', originText: '3:43 "Why are we going to win?"; a choice of two after Chris (13 Oct)', min: 0.25,
      question: "When a $5-20mm client chooses us, it's mostly for ________.",
      instruction: "Both matter. Tap the one that's closer to your view.", notes: [],
      docPair: "Read against the three reasons in 2.1, 3.2, and 'Bankers we hire who bring clients' in 5.4a.",
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'tradeWin', mode: 'one', shuffle: true, layout: 'row', tradeoff: true, missing: 'Tap one',
        options: [
          { id: 'name', label: 'The J.P. Morgan name' },
          { id: 'banker', label: 'Their banker' },
        ],
      },
    },
    {
      id: '1.4', kind: 'question', template: 'checklist', chapter: 'I', title: 'Investment advice: banker or central team',
      origin: 'Added', originText: 'after Chris (13 Oct, comment 2: the banker solo or an investments centre of excellence)', min: 0.25,
      question: 'For a $5-20mm client, investment advice works better from ________.',
      // v2: its own line. The two options are two ways of doing the same thing, so "Both matter" did not fit
      instruction: "Both can work. Tap the one that's closer to your view.", notes: [],
      docPair: "Read against who the client deals with for Engage in 2.3, and the 4.3 stamps for 'Specialist investment advice when they ask' and 'An investment specialist resource'.",
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'tradeAdvice', mode: 'one', shuffle: true, layout: 'row', tradeoff: true, missing: 'Tap one',
        options: [
          { id: 'banker', label: 'Their banker' },   // v2: no "alone", which made the banker sound like the weaker option
          { id: 'central-team', label: 'A central investment team', hint: "Investment specialists who serve many bankers' clients" },   // the same team as 2.3's part 3 and the 2.5 and 4.3 hints
        ],
      },
    },

    /* ============================== II · What we offer */
    { id: 'break-II', kind: 'break', template: 'break', chapter: 'II', title: 'Chapter break', origin: 'Added', originText: '§2.5 chapter breaks', min: 0.12, next: 'Next', rule: null, data: {} },
    // v3 (Adam, 15 Oct; Chris: "it's a reframe, something to lead section 2"): before any product or service is sorted,
    // the big picture in their own words. Adam's two sentences, word for word apart from "to" and "those". Three answers,
    // each a few short sentences no longer than a tweet (280 characters). Shown as three client quotes (skin 'quotes').
    {
      id: '2.1', kind: 'question', template: 'text', chapter: 'II', title: 'What drew clients to J.P. Morgan: three reasons',
      origin: 'Adam', originText: "Adam's review (15 Oct): his counter option, leading section 2", min: 2.5,
      bridge: 'Picture it five years after launch. J.P. Morgan has an industry-leading platform to cover HNW clients.',
      question: 'When those clients are asked what drew them to J.P. Morgan, they consistently say:',
      instruction: 'Write a few short sentences for each, up to the length of a tweet.', notes: [],
      docHow: 'Three answers, numbered 1 to 3, each a few short sentences of up to 280 characters (the length of a tweet). On screen they sit as three client quotes, each with a live character count.',
      next: 'Next', rule: 'Write all three, 3 characters or more each',
      data: {
        store: 'drewThem', skin: 'quotes', counterFrom: 0, phoneNext: 'Next reason',
        counter: '{n} left',   // the live count under each quote; typing stops at the limit
        fields: [
          { id: 'r1', stem: '1.', limit: 280, required: true, min: 3 },
          { id: 'r2', stem: '2.', limit: 280, required: true, min: 3 },
          { id: 'r3', stem: '3.', limit: 280, required: true, min: 3 },
        ],
      },
    },
    {
      id: '2.2', kind: 'question', template: 'piles', chapter: 'II', title: 'Product sorter, 15 cards',
      origin: 'Adam', originText: 'email; 2:20-2:50, 4:12; Haresh; Execute, Engage and Entrust moved to 2.3 and the core offerings added after Chris (13 Oct); Sharia out, ESG and thematics in (Chris, 15 Oct)', min: 1.8,
      question: 'Where does each product belong in our offer for $5-20mm clients?',
      instruction: 'Tap a pile for each card. 15 cards.',
      // v2 (Haresh, 15 Oct): definitions sit under the question, so the card labels can stay short
      notes: ["Assume we're allowed to offer each one in your market.", 'Our core offerings are Core & Multi Asset, Manager Solutions, Focus Five, Vintage and the rest of our default range.'],
      next: 'Next', rule: 'Sort all 15 cards',
      data: {
        store: 'products', shuffle: true, seed: 2240, keys: '1-4', followup: '2.2a',
        piles: PILES_OFFER, ui: PILE_UI,
        // v2: Execute, Engage and Entrust are ways of investing, not products; 2.3 asks about them (Chris, comment 2). Our core
        // offerings are added (Chris's CORE; the names and "default offering" from Haresh, 14 Oct)
        cards: [
          { id: 'securities', label: 'Shares and bonds', hint: 'Bought directly, in any market' },
          { id: 'funds', label: 'Funds and ETFs', hint: "Our funds and other managers'" },
          { id: 'core-offering', label: 'Our core offerings', hint: 'Held by most of our clients' },
          { id: 'structured', label: 'Structured products', hint: 'Notes with a set payoff or protection' },
          { id: 'derivatives', label: 'Derivatives and FX', hint: 'Options, forwards, currency hedges' },
          { id: 'alternatives', label: 'Alternatives', hint: 'Private equity, private credit, hedge funds' },
          { id: 'lombard', label: 'Lombard lending', hint: 'Borrow against the portfolio' },
          { id: 'mortgage', label: 'Mortgage', hint: 'Home loans, in their own country and abroad' },
          { id: 'banking', label: 'Everyday banking', hint: 'Current account, cards, payments' },
          { id: 'deposits', label: 'Cash and deposits', hint: 'Time deposits and call accounts' },
          { id: 'insurance', label: 'Life insurance and wrappers', hint: 'Life cover and PPLI, but not pensions' },
          { id: 'retirement', label: 'Pension and retirement accounts', hint: 'Local tax-advantaged pension plans' },
          { id: 'crypto', label: 'Crypto and digital assets', hint: 'Bitcoin and ether, directly or through ETPs' },
          { id: 'esg', label: 'ESG investments', hint: 'Sustainable funds and portfolios' },
          { id: 'thematic', label: 'Thematic investments', hint: 'Themes such as AI, healthcare or energy' },
        ],
        // a plausible leader's answer (from piles.html), used when 2.2 was not played
        sample: { securities: 'critical', funds: 'core', 'core-offering': 'core', structured: 'nice', derivatives: 'nice', alternatives: 'critical', lombard: 'critical', mortgage: 'nice', banking: 'core', deposits: 'core', insurance: 'nice', retirement: 'critical', crypto: 'not-hnw', esg: 'nice', thematic: 'core' },
      },
    },
    {
      id: '2.2a', kind: 'followup', template: 'podium', chapter: 'II', parent: '2.2', title: 'Top 3 products',
      origin: 'Added', originText: 'R9 §2.3', min: 0.4,
      bridge: 'These are the products in your Critical pile.',
      question: 'Which three products matter most to winning?',
      instruction: 'Pick your top 3, most important first.', notes: [],
      previewCondition: 'Shows only if Critical holds more than 3 cards.',
      next: 'Next', rule: 'Pick 3',
      data: {
        store: 'productsTop3', ui: PODIUM_UI, compact: true, maxPodium: 8,
        optionsFrom: { step: '2.2', pile: 'critical' },   // cards from the parent's Critical pile, in pile order
        aboveMax: 'fan',                                   // above 8 Critical cards: tap 1, 2, 3 in the fanned pile (gold discs)
      },
    },
    // v2 (Chris, comment 2): his three dimensions in one question. For each of Execute, Engage and Entrust: where it
    // belongs in the offer (the service), which products it covers (from the investment products kept on 2.2), and who,
    // if anyone, helps the client (the human behind it). His examples come out of the answers rather than being fixed
    // cards: Engage with only the core offerings and funds ticked is his "constrained choice"; Execute with an execution
    // desk is his human-desk version. On screen, one card at a time; Not for HNW skips the card's other two parts.
    {
      id: '2.3', kind: 'question', template: 'configure', chapter: 'II', title: 'Ways of investing: where each belongs, what it covers, who helps',
      origin: 'Haresh', originText: 'Haresh: "Brokerage, Discretionary, Engage"; three parts each after Chris (13 Oct, comment 2: the products, the service they come in and the human, if any, behind it)', min: 1.5,
      question: 'How would each way of investing work for a $5-20mm client?',
      instruction: 'Answer the three parts for each one.',
      notes: ['Our core offerings are Core & Multi Asset, Manager Solutions, Focus Five, Vintage and the rest of our default range.'],
      // the document's line (the generated one can't say that part 3's options differ for Execute)
      docHow: "One card each for Execute, Engage and Entrust, with three parts on each. Not for HNW skips the other two. In part 2 they tick at least one product; the list holds only the investment products not put in Not for HNW on 2.2 (if none are left, part 2 is skipped). Part 3 has its own options for Execute.",
      next: 'Next', rule: 'Answer all three parts for each (Not for HNW skips the other two; at least one product)',
      data: {
        store: 'investWays',
        // the three ways of investing (rows); each hint says what the word means, as v1's cards did
        items: [
          { id: 'execute', label: 'Execute', hint: 'Brokerage: the client decides, we place the trade' },
          { id: 'engage', label: 'Engage', hint: 'Advisory: we advise, the client decides' },
          { id: 'entrust', label: 'Entrust', hint: 'Discretionary: we manage the money within agreed limits' },
        ],
        // the three parts (columns), asked for each way of investing
        parts: [
          { id: 'belongs', head: 'Where it belongs', question: 'Where does it belong in our offer?', mode: 'one', options: PILES_OFFER },
          {
            id: 'covers', head: 'Products it covers', question: 'Which products does it cover?', mode: 'any',
            // the investment products from 2.1; only those not put in Not for HNW there are offered
            optionsFrom: { step: '2.2', excludePile: 'not-hnw' },
            options: [
              { id: 'securities', label: 'Shares and bonds' },
              { id: 'funds', label: 'Funds and ETFs' },
              { id: 'core-offering', label: 'Our core offerings', hint: 'Held by most of our clients' },
              { id: 'structured', label: 'Structured products' },
              { id: 'alternatives', label: 'Alternatives' },
              { id: 'derivatives', label: 'Derivatives and FX' },
              { id: 'crypto', label: 'Crypto and digital assets' },
              { id: 'esg', label: 'ESG investments' },
              { id: 'thematic', label: 'Thematic investments' },
            ],
            min: 1,   // at least one product for each way of investing kept; skipped if 2.1 left none
          },
          {
            // the person the client deals with (Chris: "what human, if any, is enabling that service"), not who manages
            // the money: our portfolio managers run Entrust whichever is picked. Execute carries no advice, so it has its
            // own three options; the central investment team (1.6, 2.3, 4.3) can back the banker or deal with the client
            // directly (Chris: "delivered by an investments center for excellence or ... banker can do it solo")
            id: 'who', head: 'Who the client deals with', question: 'Who does the client mainly deal with?', mode: 'one',
            options: [
              { id: 'online', label: "No one, it's all online" },
              { id: 'desk', label: 'An execution desk', only: ['execute'] },
              { id: 'banker', label: 'Their banker', only: ['execute'] },
              { id: 'banker-alone', label: 'Their banker alone', only: ['engage', 'entrust'] },
              { id: 'central', label: 'Their banker, backed by a central investment team', hint: 'Works behind the banker', only: ['engage', 'entrust'] },
              { id: 'central-direct', label: 'The central investment team directly', only: ['engage', 'entrust'] },
              { id: 'investor', label: 'An investment specialist resource alongside the banker', hint: 'Joins client meetings', only: ['engage', 'entrust'] },   // Chris, 15 Oct: not "dedicated Investor"
            ],
          },
        ],
        skipRest: { part: 'belongs', on: 'not-hnw' },   // Not for HNW: the card's other two parts are skipped
        // interface lines for the screen (not in the document): where they are, the skip line, the Next labels
        ui: {
          of: '({k} of {n})',                                     // after the item names: "Execute · Engage · Entrust (1 of 3)"
          skipped: 'Skipped: not for HNW',
          noneLeft: 'You put every investment product in Not for HNW, so this part is skipped.',
          missing: { belongs: 'Pick where it belongs', covers: 'Tick at least one product', who: 'Pick who they deal with' },
        },
        sample: {
          execute: { belongs: 'core', covers: ['securities', 'funds'], who: 'online' },
          engage: { belongs: 'critical', covers: ['funds', 'core-offering', 'structured'], who: 'central' },
          entrust: { belongs: 'core', covers: ['core-offering', 'alternatives'], who: 'banker-alone' },
        },
      },
    },
    // v3 (Chris, 15 Oct: "how much choice people think these clients should have ... should they be limited to 3 or 4
    // risk profiles ... how much do we create choice but within a contained way so that we can scale"). A scale from a
    // model portfolio to fully bespoke, with the tension on its ends; the approved-list stop is the UBS My Way idea,
    // unnamed. No "should" in the wording (Chris's own pattern 3).
    {
      id: '2.4', kind: 'question', template: 'track', chapter: 'II', title: 'How much customisation: standard to bespoke',
      origin: 'Added', originText: 'Chris (15 Oct): how much choice and customisation, in a contained way so we can scale', min: 0.45,
      previewCondition: 'Shows only if Engage or Entrust is not put in Not for HNW on 2.3.',
      question: 'For advisory and discretionary portfolios, how much customisation would you offer a $5-20mm client?',
      instruction: 'Tap one.',
      // the note asks for a judgement about scale rather than stating that choice is costly (no leading prompt)
      notes: ['Think about what we could deliver well as client numbers grow.'],
      docHow: 'Pick one point on a scale that runs from the most standard to the most tailored.',
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'choice', missing: 'Tap one', followup: '2.4a',
        ends: ['Most standard', 'Most tailored'],
        stops: [
          { id: 'standard', label: 'A standard portfolio for their risk profile', hint: 'No changes' },
          { id: 'limited-changes', label: 'A standard portfolio, with limited changes', hint: 'Only from an approved list' },
          { id: 'building-blocks', label: 'Their own mix of approved building blocks', hint: 'Within set limits' },
          { id: 'full-range', label: 'Tailored from our full investment range' },
          { id: 'bespoke', label: 'Fully bespoke', hint: 'Investments outside our range considered case by case' },
        ],
      },
    },
    {
      id: '2.4a', kind: 'followup', template: 'checklist', chapter: 'II', parent: '2.4', title: 'How many risk profiles',
      origin: 'Added', originText: 'Chris (15 Oct): "should they be limited to 3 or 4 risk profiles"', min: 0.2,
      previewCondition: 'Shows only if 2.4 is shown.',
      bridge: 'On risk profiles.',
      question: 'How many standard risk profiles would you offer these clients?',
      instruction: 'Tap one.', notes: [],
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'riskProfiles', mode: 'one', shuffle: false, missing: 'Tap one',
        options: [
          { id: '1-2', label: 'One or two' },
          { id: '3', label: 'Three', hint: 'e.g. Conservative, Balanced, Growth' },
          { id: '4', label: 'Four' },
          { id: '5', label: 'Five' },
          { id: '6+', label: 'Six or more' },
          { id: 'none', label: 'No fixed menu', hint: 'Risk limits agreed client by client' },
        ],
      },
    },
    {
      id: '2.5', kind: 'question', template: 'piles', chapter: 'II', title: 'Service sorter, 12 cards in four groups',
      origin: 'Adam', originText: 'email; 2:25, 4:12; Haresh; groups after Chris (13 Oct, comment 3)', min: 1.6,
      question: 'Where does each service belong in our offer for $5-20mm clients?',
      instruction: 'Tap a pile for each card. 12 cards.',
      notes: ['Services are what we do for the client.'],
      next: 'Next', rule: 'Sort all 12 cards',
      data: {
        store: 'services', shuffle: true, seed: 2250, keys: '1-4', followup: '2.5a',
        piles: PILES_OFFER, ui: PILE_UI,
        // v2: each card carries its group (printed on the card; subheads in the document). Listed group by group; the
        // deck is still shuffled. "Specialist resources" is Chris's category (comment 3). v3: the Investor card
        // takes Chris's name (15 Oct), "investment specialist"; on call here, assigned to the banker in 4.3. Its hint
        // names the same central investment team as 1.4, 2.3 and 4.3.
        cards: [
          { id: 'named-banker', group: 'The relationship', label: 'A named banker', hint: 'One person who knows the family' },
          { id: 'service-team', group: 'The relationship', label: 'Day-to-day service team', hint: 'Payments, requests and paperwork' },
          { id: 'investor', group: 'Specialist resources', label: 'An investment specialist on call', hint: 'Portfolio advice from the central investment team' },
          { id: 'lending-specialist', group: 'Specialist resources', label: 'Lending specialist', hint: 'Tailored loans and credit' },
          { id: 'trust-estate', group: 'Specialist resources', label: 'Trust and estate specialist', hint: 'Wills, trusts and succession' },
          { id: 'tax', group: 'Specialist resources', label: 'Cross-border tax specialist', hint: "Works with the client's tax advisers" },
          { id: 'wealth-plan', group: 'Planning and reporting', label: 'A written wealth plan', hint: 'Goals, cash flow and retirement maths' },
          { id: 'whole-wealth', group: 'Planning and reporting', label: 'Whole-wealth report', hint: 'One view, including money held elsewhere' },
          { id: 'next-gen', group: 'Family and life events', label: 'Family and next generation', hint: "Family meetings, heirs' education" },
          { id: 'business-owner', group: 'Family and life events', label: 'Help for business owners', hint: 'Company banking, a sale or listing' },
          { id: 'mobility', group: 'Family and life events', label: 'Help moving country', hint: 'Residency, relocation, schooling abroad' },
          { id: 'cyber', group: 'Family and life events', label: 'Cyber and fraud protection', hint: 'Keeping the family safe online' },
        ],
        sample: { 'named-banker': 'critical', investor: 'critical', 'wealth-plan': 'core', 'trust-estate': 'core', 'lending-specialist': 'nice', 'service-team': 'core', tax: 'nice', 'next-gen': 'nice', 'whole-wealth': 'critical', 'business-owner': 'critical', cyber: 'core', mobility: 'not-hnw' },
      },
    },
    {
      id: '2.5a', kind: 'followup', template: 'podium', chapter: 'II', parent: '2.5', title: 'Top 3 services',
      origin: 'Added', originText: 'R9 §2.3', min: 0.4,
      bridge: 'These are the services in your Critical pile.',
      question: 'Which three matter most to winning?',
      instruction: 'Pick your top 3, most important first.', notes: [],
      previewCondition: 'Shows only if Critical holds more than 3 cards.',
      next: 'Next', rule: 'Pick 3',
      data: { store: 'servicesTop3', ui: PODIUM_UI, compact: true, maxPodium: 8, optionsFrom: { step: '2.5', pile: 'critical' }, aboveMax: 'fan' },
    },
    {
      id: '2.6', kind: 'question', template: 'trays', chapter: 'II', title: 'Who is best placed to provide it',
      origin: 'Added', originText: 'R0 §5; R3 §7.5; fourth tray after Chris (13 Oct, comment 4)', min: 0.6,
      question: 'If clients want these, who is best placed to provide them?',
      instruction: 'Put each one in a tray. {n} items.',
      notes: ['Another J.P. Morgan business means Chase where it operates, the CIB or Asset Management.'],
      previewNote: "Items come from 2.2: the ones not put in Not for HNW, plus the client's company.",
      next: 'Next', rule: 'Put every item in a tray',
      data: {
        store: 'provide', shuffle: true, missing: 'Place {n} more',
        trays: [
          { id: 'pb', label: 'Build it in the Private Bank' },
          { id: 'jpm', label: 'Another J.P. Morgan business' },
          { id: 'partner', label: 'An outside partner' },
          { id: 'none', label: 'Not necessary to provide' },
        ],
        tiles: [
          { id: 'banking', label: 'Everyday banking' },
          { id: 'mortgage', label: 'Mortgage' },
          { id: 'insurance', label: 'Life insurance and wrappers' },
          { id: 'retirement', label: 'Pension and retirement accounts' },
          { id: 'crypto', label: 'Crypto and digital assets' },
          { id: 'business-banking', label: "Banking for the client's company", always: true },
        ],
        // keep a tile only if 2.1 did not put it in Not for HNW; `always` tiles are always shown
        tilesFrom: { step: '2.2', excludePile: 'not-hnw' },
      },
    },

    /* ============================== III · Winning the client */
    { id: 'break-III', kind: 'break', template: 'break', chapter: 'III', title: 'Chapter break', origin: 'Added', originText: '§2.5 chapter breaks', min: 0.12, next: 'Next', rule: null, data: {} },
    {
      id: '3.1', kind: 'question', template: 'ladder', chapter: 'III', title: 'Share-of-wallet column', stage: true,
      origin: 'Adam', originText: 'email; 4:23-4:48; 1 row Added', min: 2.4,
      question: "A typical $10mm client chooses us. With today's offer, what share of their money would we hold?",
      instruction: 'Tap the column or type a percentage.',
      notes: ['Count only their cash and investments.'],
      next: 'Next', rule: "Set today's share, then each row, then all four together",
      data: {
        store: 'wallet', client: 10,
        // three internal steps on one screen; the template owns Next and Back between them (ui.setBand per step)
        steps: [
          { bridge: '', question: "A typical $10mm client chooses us. With today's offer, what share of their money would we hold?", instruction: 'Tap the column or type a percentage.', notes: ['Count only their cash and investments.'], missing: 'Set a share' },
          { bridge: "What we could add to today's offer.", question: 'If we also offered each of these, what share of their cash and investments would we hold?', instruction: 'Type a new share for each. 5 rows.', notes: ["Take each one on its own. Count money they'd move to us, not loans."], missing: 'Set {n} more' },
          { bridge: 'Last, the first four rows together.', question: 'If we offered all four of these together, what share would we hold?', instruction: 'Tap the column or type a percentage.', notes: [], missing: 'Set one share for all four' },
        ],
        rows: [
          { id: 'banking', label: 'Everyday banking', short: 'Banking', hint: 'Current account, cards, payments', four: true },
          { id: 'mortgage', label: 'Mortgage', short: 'Mortgage', hint: 'Home loans sized for HNW, in their country and abroad', four: true },
          { id: 'retirement', label: 'Pension and retirement accounts', short: 'Pensions', hint: 'Local tax-advantaged pension plans', four: true },
          { id: 'insurance', label: 'Life insurance and wrappers', short: 'Insurance', hint: 'Life cover and PPLI, but not pensions', four: true },
          { id: 'alternatives', label: 'Alternatives at lower minimums', short: 'Alternatives', hint: 'Private equity and credit funds', four: false },
        ],
        ui: {
          readout: '{p}% · ${m}mm of $10mm',
          rangeError: 'From 0% to 100%',
          todayTab: 'Today · {p}%',
          rowChip: 'No change',
          rowRangeError: 'From {base}% to 100%',
          step3Label: 'All four together',
          check: 'Your share for all four is lower than for [{row}] alone. Is that what you meant?',
        },
        snap: 5, rowStep: 5,
        sample: { base: 40, banking: 50, mortgage: 55, retirement: 50, insurance: 45, alternatives: 50, four: 70 },
      },
    },
    {
      id: '3.2', kind: 'question', template: 'podium', chapter: 'III', title: 'Why move money to us: top 3 of 10',
      origin: 'Adam', originText: '1:38; mechanic Added', min: 1.0,
      question: 'Why would a $5-20mm client move money to us rather than to their main bank?',
      instruction: 'Pick your top 3, most important first.', notes: [],
      next: 'Next', rule: 'Pick 3',
      data: {
        store: 'whyUs', ui: PODIUM_UI, compact: true, shuffle: true, hints: true,
        options: [
          { id: 'safety', label: 'The strength and safety of J.P. Morgan' },
          { id: 'performance', label: 'Better investment performance' },
          { id: 'alternatives', label: 'Access to alternatives', hint: 'Private markets and hedge funds' },
          { id: 'specialists', label: 'Specialists on call', hint: 'Tax and cross-border experts' },
          { id: 'lending', label: 'Lending against their portfolio' },
          { id: 'banker', label: 'A senior banker who knows the family' },
          { id: 'multi-country', label: 'Accounts in more than one country' },
          { id: 'pricing', label: 'Clear, fair pricing' },
          { id: 'app', label: 'A first-class app (JPOI)' },
          { id: 'next-gen', label: 'Help passing wealth to the next generation' },
        ],
        sample: ['banker', 'alternatives', 'safety'],
      },
    },
    {
      id: '3.3', kind: 'question', template: 'rank', chapter: 'III', title: 'What makes a client feel special', stage: true,
      origin: 'Adam', originText: 'email; 4:51-5:16', min: 1.9,
      question: 'What makes a $5-20mm client feel most special with us?',
      instruction: 'Place all 10. Most important at 1.', notes: [],
      next: 'Next', rule: 'Place all 10',
      data: {
        store: 'special', shuffle: true, ui: RANK_UI,
        blocks: [
          { id: 'gifts', label: 'Gifts' },
          { id: 'events', label: 'Social events' },
          { id: 'intellectual-capital', label: 'Intellectual capital', hint: 'Our research and market views' },
          { id: 'meetings', label: 'In-person meetings' },
          { id: 'offices', label: 'Beautiful offices' },
          { id: 'brand', label: 'The J.P. Morgan brand' },
          { id: 'leaders', label: 'Access to senior leaders' },
          { id: 'first-look', label: 'First look at exclusive investments', hint: 'Co-investments and private deals' },
          { id: 'calls-first', label: 'A banker who calls first', hint: 'Before the client asks' },
          { id: 'next-gen', label: 'Programmes for the next generation', hint: 'Heirs and family members' },
        ],
        sample: ['calls-first', 'meetings', 'leaders', 'first-look', 'intellectual-capital', 'brand', 'next-gen', 'events', 'offices', 'gifts'],
      },
    },

    /* ============================== IV · Who gets what */
    { id: 'break-IV', kind: 'break', template: 'break', chapter: 'IV', title: 'Chapter break', origin: 'Added', originText: '§2.5 chapter breaks', min: 0.12, next: 'Next', rule: null, data: {} },
    {
      id: '4.1', kind: 'question', template: 'sentence', chapter: 'IV', title: 'The HNW floor in my market',
      origin: 'Adam', originText: 'email', min: 0.5,
      question: 'In my market, any client with more than $[    ]mm would demand services consistent with an HNW offering.', questionIsObject: true,
      instruction: 'Type an amount in millions of US dollars.',
      notes: ["Liquid net worth. It doesn't have to match the $5-20mm range."],
      next: 'Next', rule: 'Type an amount from $0.5mm to $50mm',
      data: {
        store: 'floor',
        rows: [{ parts: ['In my market, any client with more than ', { slot: 'number', id: 'mm', prefix: '$', suffix: 'mm', min: 0.5, max: 50, step: 0.5, decimals: 1 }, ' would demand services consistent with an HNW offering.'] }],
        checks: [{ when: { slot: 'mm', gt: 20 }, text: "That's above $20mm, where UHNW starts. Do you want to keep it?" }],
        sample: { mm: 5 },
      },
    },
    {
      id: '4.1a', kind: 'followup', template: 'checklist', chapter: 'IV', parent: '4.1', title: 'Where a client just below the floor goes',
      origin: 'Added', originText: 'draft A IV.1', min: 0.2,
      bridge: 'Then, clients just under that amount.',
      question: 'Where does a client just below $[X]mm go?',
      instruction: 'Tap one.', notes: [],
      previewNote: '[X] is the amount typed on 4.1.',
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'floorBelow', mode: 'one', shuffle: false, missing: 'Tap one',
        vars: { X: { from: '4.1', key: 'mm', sample: 5, format: 'number' } },
        options: [
          { id: 'take-anyway', label: "We take them if they're likely to grow" },
          { id: 'jpm-other', label: 'Another J.P. Morgan business, where we have one', hint: 'e.g. Chase UK, Personal Investing' },
          { id: 'partner', label: 'A partner firm we refer them to' },
          { id: 'none', label: "We don't serve them" },
        ],
      },
    },
    {
      id: '4.2', kind: 'question', template: 'sentence', chapter: 'IV', title: 'The move to UHNW coverage',
      origin: 'Adam', originText: 'email', min: 0.6,
      question: 'At $[    ]mm in balances with us, I would [offer · suggest · require] a move to UHNW coverage.', questionIsObject: true,
      instruction: 'Type an amount, then tap one word.',
      notes: ["Deposits and investments with J.P. Morgan. Loans don't count."],
      next: 'Next', rule: 'A number and a word, or Never',
      data: {
        store: 'ceiling',
        rows: [{ parts: [
          'At ', { slot: 'number', id: 'mm', prefix: '$', suffix: 'mm', min: 1, max: 200, step: 5, decimals: 1, typeStep: 0.5 },
          ' in balances with us, I would ',
          { slot: 'chips', id: 'verb', options: [{ id: 'offer', label: 'offer' }, { id: 'suggest', label: 'suggest' }, { id: 'require', label: 'require' }] },
          ' a move to UHNW coverage.',
        ] }],
        optOut: { id: 'never', label: 'Never. UHNW specialists join their team instead' },
        // soft check in one unit: mm / (3.1 base / 100) <= 4.1 floor. Never shows a number. No check on Never.
        checks: [{ when: { custom: 'ceiling-below-floor', wallet: '3.1', floor: '4.1' }, text: 'Some clients with that much at J.P. Morgan could still be below where you said HNW starts.' }],
        sample: { mm: 15, verb: 'suggest' },
      },
    },
    {
      id: '4.3', kind: 'question', template: 'stamp', chapter: 'IV', title: 'Every client, above an amount, or none: 10 cards',
      origin: 'Adam', originText: '6:00-6:17; email', min: 1.3,
      question: 'Who gets each of these: every $5-20mm client, only those above an amount, or none?',
      instruction: 'Stamp each card. 10 cards.',
      notes: ['Dedicated means they work with a fixed list of clients.'],
      next: 'Next', rule: 'Stamp all 10 cards',
      data: {
        store: 'entitled', skin: 'plain', shuffle: true, missing: 'Stamp {n} more', followup: '4.3a',
        stamps: [
          { id: 'every', label: 'Every HNW client', impression: 'EVERY', glyph: 'tick' },
          { id: 'above', label: 'Only above an amount', impression: 'ONLY ABOVE', glyph: 'step' },
          { id: 'none', label: 'No HNW client', impression: 'NONE', glyph: 'cross' },
        ],
        cards: [
          { id: 'banker', label: 'A dedicated banker of their own', hint: 'One named banker', role: true },
          { id: 'investor', label: 'An investment specialist resource', hint: 'Assigned to work with the banker', role: true },   // Chris, 15 Oct
          { id: 'wa', label: 'A dedicated Wealth Advisor (WA)', hint: 'Trusts, estates and wealth structuring', role: true },
          { id: 'ca', label: 'A dedicated Capital Advisor (CA)', hint: 'Lending and credit', role: true },
          { id: 'css', label: 'A dedicated Client Service Specialist (CSS)', hint: 'Day-to-day service', role: true },
          // Adam's label (6:10); the hint names the same team as 1.4, 2.3's part 3 and the 2.5 investment specialist card
          { id: 'specialist-advice', label: 'Specialist investment advice when they ask', hint: 'From the central investment team' },
          { id: 'wealth-plan', label: 'A written wealth plan, updated each year' },
          { id: 'annual-review', label: 'An in-person review every year' },
          { id: 'events', label: 'Invitations to client events' },
          { id: 'remote-opening', label: 'Opening an account without meeting us' },
        ],
        sample: { banker: 'above', investor: 'none', wa: 'above', ca: 'none', css: 'every', 'specialist-advice': 'every', 'wealth-plan': 'above', 'annual-review': 'every', events: 'above', 'remote-opening': 'every' },
      },
    },
    {
      id: '4.3a', kind: 'followup', template: 'sentence', chapter: 'IV', parent: '4.3', title: 'From what amount, for each role',
      origin: 'Added', originText: '', min: 0.3,
      bridge: 'Next, the amounts for those roles.',
      question: 'From what amount does a client get each one?',
      instruction: 'Type an amount for each role.',
      notes: ['Liquid net worth, in millions of US dollars.'],
      previewCondition: 'Shows only if a role (banker, investment specialist resource, WA, CA or CSS) is stamped Only above an amount. One row per such role.',
      next: 'Next', rule: 'Type an amount for each row',
      data: {
        store: 'entitledFrom',
        // one row per role stamped "above" on 4.3, in card order
        rowsFrom: { step: '4.3', stamp: 'above', roles: ['banker', 'investor', 'wa', 'ca', 'css'] },
        // v3: each role carries its own words, since the investment specialist resource (Chris, 15 Oct) is not "dedicated"
        roleWords: { banker: 'a dedicated banker', investor: 'an investment specialist resource', wa: 'a dedicated Wealth Advisor (WA)', ca: 'a dedicated Capital Advisor (CA)', css: 'a dedicated Client Service Specialist (CSS)' },
        rowParts: ['From ', { slot: 'number', id: '{role}', prefix: '$', suffix: 'mm', min: 5, max: 20, step: 0.5, decimals: 1 }, ', a client gets ', { slot: 'role' }, '.'],
        sampleRoles: ['banker', 'wa'],
      },
    },
    {
      id: '4.4', kind: 'question', template: 'checklist', chapter: 'IV', title: 'Clients we already have', sensitive: true,
      origin: 'Added', originText: 'R0 §5', min: 0.3,
      question: 'Some IPB clients today have $5-20mm. What happens to them at launch?',
      instruction: 'Tap one.', notes: [],
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'existing', mode: 'one', shuffle: true, missing: 'Tap one',
        options: [
          { id: 'stay', label: 'Stay with their banker, as today' },
          { id: 'move', label: 'Move to the new HNW service' },
          { id: 'family', label: 'Stay if part of a UHNW family', hint: 'Otherwise they move to the HNW service' },
          // v2: replaces "Each client chooses", which Chris called not a real choice (comment 5)
          { id: 'case-by-case', label: 'Case by case', hint: 'We look at each relationship and decide' },
        ],
      },
    },

    /* ============================== V · Where the money sits */
    { id: 'break-V', kind: 'break', template: 'break', chapter: 'V', title: 'Chapter break', origin: 'Added', originText: '§2.5 chapter breaks', min: 0.12, next: 'Next', rule: null, data: {} },
    {
      id: '5.1', kind: 'question', template: 'allocate-ledger', chapter: 'V', title: 'Ledger: the split, then banking and cash', stage: true,
      origin: 'Adam', originText: 'email; 5:16-5:33', min: 1.4,
      question: "A typical $10mm client chooses us. With today's offer, how is their money split, and who holds it?",
      instruction: 'Type the split, then amounts in $mm.',
      notes: ['Banking and cash means current accounts, deposits and money funds.'],
      next: 'Next', rule: 'Type the split, then make the Banking and cash column equal it',
      data: {
        store: 'ledgerCash', phase: 'cash', rows: LEDGER_ROWS, shuffle: true, jpmNeverFirst: true, ui: LEDGER_UI,
        split: { parts: ['Of their $10mm, $', { slot: 'number', id: 'split', min: 0, max: 10, decimals: 1 }, 'mm is in banking and cash. The rest is invested.'] },
        status: { noSplit: 'Type the split above to open the Banking and cash column.', zero: 'Nothing in banking and cash.' },
        missing: { noSplit: 'Type the split', left: '{x} left to place', over: '{x} too much' },
        step: 0.5, typeStep: 0.1,
        sample: { split: 4, jpm: 1, champion: 2, global: 0.5, neobank: 0.5 },
      },
    },
    {
      id: '5.2', kind: 'question', template: 'allocate-ledger', chapter: 'V', title: 'Ledger: investments', stage: true,
      origin: 'Adam', originText: 'email; 5:16-5:33', min: 1.2,
      question: 'The other $[X]mm is invested. Who holds it?',
      instruction: 'Type amounts in $mm. They must add up to $[X]mm.',
      notes: ['If J.P. Morgan manages money inside a wrapper, count it as J.P. Morgan.'],
      previewNote: '[X] is $10mm minus the split typed on 5.1.',
      next: 'Next', rule: 'Make the Investments column add up to $[X]mm',
      data: {
        // the footer counts toward the active column (design §4 ledger), so 5.2's running line names Investments
        store: 'ledgerInvest', phase: 'inv', rows: LEDGER_ROWS, shuffle: true, jpmNeverFirst: true,
        ui: Object.assign({}, LEDGER_UI, { running: 'Investments: {placed} of {target} · {left} left' }),
        vars: { X: { from: '5.1', key: 'split', sample: 4, compute: 'rest-of-10', format: 'mm1' } },
        cashFrom: '5.1',
        status: { none: 'Nothing left to place.' },
        missing: { left: '{x} left to place', over: '{x} too much' },
        step: 0.5, typeStep: 0.1,
        sample: { jpm: 3, global: 1.5, independent: 0.5, wrappers: 1 },
      },
    },
    {
      id: '5.2a', kind: 'followup', template: 'checklist', chapter: 'V', parent: '5.2', title: 'Whose clients to try hardest to win',
      origin: 'Adam', originText: 'email, "The ideal target client is likely to look like..."; reading Assumed', min: 0.3,
      bridge: 'Who they bank with now.',
      // v2: "would you" for v1's "should we"; it keeps Adam's ideal target client (not who we are most likely to win)
      question: 'Whose clients would you try hardest to win?',
      instruction: 'Tap one.', notes: [],
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'targetClient', mode: 'one', shuffle: true, missing: 'Tap one', look: 'ledger',
        options: [
          { id: 'champion', label: 'The national champion bank' },
          { id: 'global', label: 'Another bank', hint: 'Global, private or another local bank' },
          { id: 'independent', label: 'An independent adviser or family office' },
          { id: 'broker', label: 'An online broker' },
          { id: 'neobank', label: 'A digital bank' },
          { id: 'jpm-feeders', label: 'Clients already with J.P. Morgan elsewhere', hint: 'e.g. Workplace, the CIB, Chase where it operates' },
          { id: 'uhnw-families', label: 'Families of our UHNW clients', hint: 'Heirs and relatives banked elsewhere' },
        ],
      },
    },
    {
      id: '5.3', kind: 'question', template: 'trays', chapter: 'V', title: 'Local bank or J.P. Morgan, 10 tiles',
      origin: 'Adam', originText: '1:38; mechanic Added', min: 0.9,
      question: 'What will a $5-20mm client keep with their local bank, and what will they bring to us?',
      instruction: 'Put each one in a tray. 10 items.', notes: [],
      next: 'Next', rule: 'Put all 10 in a tray',
      data: {
        store: 'locals', shuffle: true, missing: 'Place {n} more',
        trays: [
          { id: 'local', label: 'Stays with the local bank' },
          { id: 'jpm', label: 'Comes to J.P. Morgan' },
          { id: 'either', label: 'Could be either' },
        ],
        tiles: [
          { id: 'day-to-day', label: 'Day-to-day account' },
          { id: 'salary', label: 'Salary and local payments' },
          { id: 'home-loan', label: 'Mortgage on their home' },
          { id: 'local-deposits', label: 'Local-currency deposits' },
          { id: 'usd-deposits', label: 'US-dollar deposits' },   // v2: in Hong Kong or Singapore "dollar" alone is ambiguous
          { id: 'local-shares', label: 'Trading local shares' },
          { id: 'advice', label: 'Investment advice' },
          { id: 'lombard', label: 'Lombard lending' },
          { id: 'alternatives', label: 'Alternatives' },
          { id: 'succession', label: 'Trusts and succession' },
        ],
      },
    },
    {
      id: '5.3a', kind: 'followup', template: 'checklist', chapter: 'V', parent: '5.3', title: 'Where the money is booked',
      origin: 'Added', originText: 'R1 §4.4; R5 §6.4', min: 0.3,
      bridge: 'This is only about the money that comes to us.',
      question: 'Where would you book that money?',
      instruction: 'Tap one.', notes: [],
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'booking', mode: 'one', shuffle: false, places: true, missing: 'Tap one',
        options: [
          { id: 'onshore', label: "In the client's own country" },
          { id: 'sg-hk', label: 'Singapore or Hong Kong' },
          { id: 'ch', label: 'Switzerland (Geneva or Zurich)' },
          { id: 'lux', label: 'Luxembourg (J.P. Morgan SE)' },
          { id: 'uk', label: 'The UK (London)' },
          { id: 'us', label: 'The US (New York or Miami)' },
          { id: 'client-choice', label: "The client's choice" },
        ],
      },
    },
    // v2 (Chris, comment 6: think at scale; Haresh, 14 Oct: ask their own number first). Each person sets the scale with
    // their own three-year number, so no figure of ours can anchor the answers (here or in 9.4), and 5.4a splits it.
    {
      id: '5.4', kind: 'question', template: 'sentence', chapter: 'V', title: 'Clients three years after launch',
      origin: 'Added', originText: 'after Chris (13 Oct, comment 6) and Haresh (14 Oct): their own number first', min: 0.4,
      question: 'Three years after launch, I expect the IPB to have about [      ] clients with $5-20mm.', questionIsObject: true,
      instruction: 'Type a number.',
      notes: ['Relationships (families), not accounts.'],
      next: 'Next', rule: 'Type a number from 0 to 200,000',
      data: {
        store: 'expect3', followup: '5.4a',
        rows: [{ parts: ['Three years after launch, I expect the IPB to have about ', { slot: 'number', id: 'n', min: 0, max: 200000, step: 100, decimals: 0, wide: true }, ' clients with $5-20mm.'] }],
        checks: [{ when: { slot: 'n', gt: 50000 }, text: '[N] client families across the whole IPB. Is that the figure you meant?' }],
        sample: { n: 3000 },
      },
    },
    {
      id: '5.4a', kind: 'followup', template: 'allocate-list', chapter: 'V', parent: '5.4', title: 'Where those clients come from',
      origin: 'Adam', originText: 'email ("% of new clients coming from"); 5:44; split of their own 5.4 number after Chris and Haresh', min: 1.4,
      bridge: 'Now, where they come from.',
      question: 'Where will those [N] clients come from?',
      instruction: 'Type a share for each. They must add up to 100%.',
      notes: ['Count each family once. Families who bank with the IPB today count as clients we already have.'],
      previewCondition: 'Shows only if the answer to 5.4 is more than 0.',
      previewNote: '[N] is the number typed on 5.4.',
      docHow: 'They type a percentage for each source, adding up to 100%. The screen also shows how many clients each percentage means, using their answer to 5.4.',
      next: 'Next', rule: 'The shares must add up to exactly 100%',
      data: {
        // shares of 100%, each also shown as clients of their 5.4 number ({c})
        store: 'sources', shuffle: true, total: 100, unit: '%', step: 5, footer: '{n}% of 100% placed · {c} of [N] clients',
        vars: { N: { from: '5.4', key: 'n', sample: 3000, format: 'number' } },
        // 5.4 counts every client in year three, so the families already with the IPB need a row of their own (pinned first)
        rows: [
          { id: 'existing', label: 'Clients we already have', hint: '$5-20mm clients with the IPB today', pinned: true },
          { id: 'client-referrals', label: 'Referrals from our clients', hint: 'Clients, their families and our UHNW bankers' },
          { id: 'introducers', label: 'Introductions from professionals', hint: 'Lawyers, accountants, external asset managers' },
          { id: 'xlob', label: 'Referrals from other J.P. Morgan businesses', hint: 'X-LOB: the CIB, Workplace, ICB (Chase UK), Personal Investing' },
          { id: 'marketing', label: 'Marketing, our website and JPOI', hint: 'Clients who find us themselves' },
          { id: 'organic', label: "Our bankers' own networks and events", hint: 'Organic lead generation' },
          { id: 'cold', label: 'Cold calling' },
          { id: 'money-in-motion', label: 'Money in motion', hint: 'We noticed a sale or inheritance ourselves' },
          { id: 'hired-books', label: 'Bankers we hire who bring clients' },
        ],
      },
    },

    /* ============================== VI · How we serve them */
    { id: 'break-VI', kind: 'break', template: 'break', chapter: 'VI', title: 'Chapter break', origin: 'Added', originText: '§2.5 chapter breaks', min: 0.12, next: 'Next', rule: null, data: {} },
    {
      id: '6.1', kind: 'question', template: 'checklist', chapter: 'VI', title: 'In person, hybrid, virtual or digital',
      origin: 'Adam', originText: '11:40', min: 0.4,
      // v2: no "three years after launch" (Chris, comment 7): we mean the business at steady state, not the client's lifecycle
      question: 'How would you cover a typical $5-20mm client?',
      instruction: 'Tap one.', notes: [],
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'coverage', mode: 'one', shuffle: false, pictures: true, layout: 'row', missing: 'Tap one',
        options: [
          { id: 'in-person', label: 'In person', hint: 'A named banker they meet face to face', picture: 'handshake' },
          { id: 'hybrid', label: 'Hybrid', hint: 'A named banker, mostly on video calls, plus JPOI', picture: 'laptop-face' },
          { id: 'virtual', label: 'Virtual', hint: 'A team of bankers by video and phone', picture: 'three-handsets' },
          { id: 'digital-first', label: 'Digital first', hint: 'JPOI first, specialists on call', picture: 'phone-chat' },
        ],
        // engraved scenes (design §4, 6.1): a handshake; a laptop with a face; three phone handsets; a phone with a chat bubble
      },
    },
    {
      id: '6.1a', kind: 'followup', template: 'sentence', chapter: 'VI', parent: '6.1', title: 'Clients per banker',
      origin: 'Haresh', originText: 'Haresh: "How many clients should that person handle?"', min: 0.3,
      bridge: 'Still on coverage.',
      question: 'About how many clients can one HNW banker cover effectively?',
      instruction: 'Type a number.',
      notes: ["With today's tools. Count relationships (families), not accounts."],
      next: 'Next', rule: 'Type a number from 10 to 500',
      data: {
        store: 'bookToday',
        // v2: "can ... effectively" (Chris, comment 8); 7.4a uses the same words so the two compare
        rows: [{ parts: ['One HNW banker can effectively cover about ', { slot: 'number', id: 'n', suffix: ' clients', min: 10, max: 500, step: 5, decimals: 0 }, '.'] }],
        checks: [{ when: { slot: 'n', lt: 15, orGt: 300 }, text: 'Did you mean [N] clients for one banker?' }],
        sample: { n: 80 },
      },
    },
    {
      id: '6.2', kind: 'question', template: 'sentence', chapter: 'VI', title: 'In-person meetings: the first year, then each year',
      origin: 'Adam', originText: 'email; 6:49; reworded after Chris (13 Oct, comments 7 and 9)', min: 0.5,
      question: 'The optimal number of in-person meetings with a client is [  ] in their first year and [  ] each year after that.', questionIsObject: true,
      instruction: 'Type two numbers.',
      notes: ["In person only. Calls and video don't count."],
      docHow: "Two numbers from 0 to 24, one for the client's first year and one for each year after.",
      next: 'Next', rule: 'Type two numbers from 0 to 24',
      data: {
        store: 'meetings',
        // v2: two slots, so the cadence can change after the first year (Chris's lifecycle point, comment 7)
        rows: [{ parts: [
          'The optimal number of in-person meetings with a client is ', { slot: 'number', id: 'first', min: 0, max: 24, step: 1, decimals: 0 },
          ' in their first year and ', { slot: 'number', id: 'after', min: 0, max: 24, step: 1, decimals: 0 }, ' each year after that.',
        ] }],
        sample: { first: 4, after: 2 },
      },
    },
    {
      id: '6.2a', kind: 'followup', template: 'checklist', chapter: 'VI', parent: '6.2', title: 'Where meetings take place',
      origin: 'Adam', originText: 'email, "The typically will be at..."; 6:55', min: 0.3,
      bridge: 'And the meetings themselves.',
      question: 'Where will most of those meetings take place?',
      instruction: 'Pick one or two.', notes: [],
      previewCondition: 'Shows only if either number on 6.2 is 1 or more.',
      next: 'Next', rule: 'Pick one or two',
      data: {
        store: 'venues', mode: 'two', min: 1, max: 2, shuffle: true, pictures: true,
        options: [
          { id: 'jpm-office', label: 'A J.P. Morgan office', picture: 'doorway' },
          { id: 'home', label: "The client's home", picture: 'house' },
          { id: 'business', label: "The client's business", picture: 'office-block' },
          { id: 'venue', label: 'A restaurant, club or hotel', picture: 'coffee-cups' },
          { id: 'wealth-centre', label: 'A J.P. Morgan wealth centre', picture: 'lounge' },
          { id: 'event', label: 'A J.P. Morgan client event', picture: 'lectern' },
        ],
        // engraved pictures: a doorway; a house; an office block; a table with two coffee cups (never stemmed glasses);
        // a lounge with armchairs; a lectern
      },
    },
    {
      id: '6.2b', kind: 'followup', template: 'track', chapter: 'VI', parent: '6.2', title: 'How far away the banker can be',
      origin: 'Adam', originText: 'email; 6:59; hub stop Added', min: 0.25,
      bridge: 'One more, about distance.',
      question: 'How far from the client can the banker be based and still serve them well?',
      instruction: 'Tap one.', notes: [],
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'distance', missing: 'Tap one',
        stops: [
          { id: 'car', label: 'A taxi or car ride away' },
          { id: 'hour-1', label: 'Up to 1 hour by train or car' },
          { id: 'hour-2', label: 'Up to 2 hours' },
          { id: 'hour-3', label: 'Up to 3 hours, a day trip' },
          { id: 'hub', label: 'Flies in from a regional hub', hint: 'e.g. Miami for Mexico, Geneva for the Gulf' },
          { id: 'any', label: "Doesn't matter" },
        ],
      },
    },
    {
      id: '6.3', kind: 'question', template: 'piles', chapter: 'VI', title: 'The ideal banker, 12 cards',
      origin: 'Adam', originText: 'email; 6:40-6:46; 13:22', min: 1.5,
      question: 'How much does each of these matter in the ideal HNW banker?',
      instruction: 'Tap a pile for each card. 12 cards.', notes: [],
      next: 'Next', rule: 'Sort all 12 cards',
      data: {
        store: 'banker', shuffle: true, seed: 2630, keys: '1-4', followup: '6.3a',
        piles: PILES_BANKER, ui: PILE_UI,
        cards: [
          { id: 'technical', label: 'Deep technical skill', hint: 'Investments, lending, structuring' },
          { id: 'eq', label: 'High EQ', hint: 'Listens well and understands the family' },
          { id: 'book', label: 'Brings a large book from a competitor' },
          { id: 'opener', label: 'Opens new client relationships', hint: 'Wins clients without a book' },
          { id: 'local-network', label: 'Known in the local business community', hint: 'Owners, lawyers, accountants' },
          { id: 'language', label: "Shares the client's language and culture" },
          { id: 'orchestrator', label: 'Involves specialists and other J.P. Morgan teams', hint: 'Leads the team around the client' },
          { id: 'digital', label: 'Fluent with digital and AI tools', hint: 'Runs a bigger book with them' },
          { id: 'judgement', label: 'Clean record and sound risk judgement', hint: 'KYC and cross-border rules' },
          { id: 'next-gen', label: 'Connects with the next generation' },
          { id: 'disciplined', label: 'Organised enough to serve many clients', hint: 'Follow-up, records, process' },
          { id: 'coachable', label: 'Keen to learn and be coached' },
        ],
        sample: { technical: 'core', eq: 'critical', book: 'nice', opener: 'critical', 'local-network': 'critical', language: 'core', orchestrator: 'critical', digital: 'core', judgement: 'core', 'next-gen': 'nice', disciplined: 'core', coachable: 'nice' },
      },
    },
    {
      id: '6.3a', kind: 'followup', template: 'podium', chapter: 'VI', parent: '6.3', title: 'Top 3 qualities',
      origin: 'Added', originText: 'R11 §1.2', min: 0.3,
      bridge: 'Take the qualities in your Critical pile.',
      question: 'Which three matter most in an HNW banker?',
      instruction: 'Pick your top 3, most important first.', notes: [],
      previewCondition: 'Shows only if Critical holds more than 3 cards.',
      next: 'Next', rule: 'Pick 3',
      data: { store: 'bankerTop3', ui: PODIUM_UI, compact: true, maxPodium: 8, optionsFrom: { step: '6.3', pile: 'critical' }, aboveMax: 'fan' },
    },
    {
      id: '6.4', kind: 'question', template: 'bottle', chapter: 'VI', title: 'Seniority of a team of 10',
      origin: 'Adam', originText: '1:38', min: 0.7,
      question: 'Picture a team of 10 HNW bankers. How senior do they need to be?',
      instruction: 'Tap a jug to add 1 banker.', notes: [],
      next: 'Next', rule: 'Place exactly 10 bankers',
      data: {
        store: 'seniority', total: 10, shuffle: false, counter: '{left} of 10 bankers left', missing: 'Add {n} more',
        jugs: [
          { id: 'md', label: 'Managing Director' },
          { id: 'ed', label: 'Executive Director' },
          { id: 'vp', label: 'Vice President' },
          { id: 'associate', label: 'Associate' },
        ],
      },
    },
    {
      id: '6.4a', kind: 'followup', template: 'sentence', chapter: 'VI', parent: '6.4', title: 'Of 10 new bankers, how many from inside',
      origin: 'Added', originText: 'draft C; R0 §5 "growing organically vs buying books"', min: 0.3,
      bridge: 'Where those bankers come from.',
      question: 'Of every 10 HNW bankers we add, how many could realistically come from inside J.P. Morgan?',
      instruction: 'Type a number.',
      notes: ['Inside means our Associates, Analyst-to-Advisor (A2A) graduates and people moving from other J.P. Morgan teams.'],
      next: 'Next', rule: 'Type a number from 0 to 10',
      data: {
        store: 'grownInside',
        rows: [{ parts: ['Of every 10 we add, about ', { slot: 'number', id: 'n', min: 0, max: 10, step: 1, decimals: 0 }, ' could come from inside J.P. Morgan and the rest from outside.'] }],
        sample: { n: 6 },
      },
    },

    /* ============================== VII · Digital and AI */
    { id: 'break-VII', kind: 'break', template: 'break', chapter: 'VII', title: 'Chapter break', origin: 'Added', originText: '§2.5 chapter breaks', min: 0.12, next: 'Next', rule: null, data: {} },
    {
      id: '7.1', kind: 'question', template: 'track', chapter: 'VII', title: 'Requests handled without a banker',
      origin: 'Haresh', originText: 'Haresh: "how much of it should be digital-first"', min: 0.35,
      // v2: "will", not "can": nearly all contact could be digital, so "can" would bunch the answers high
      question: "Three years after launch, what share of a client's requests and transactions will be handled without a banker?",
      instruction: 'Tap the line to set your answer.',
      notes: ['Count payments, trades, documents and questions, not log-ins. JPOI, the web and the service team count as without a banker.'],
      // the generated line ("from 0% to 100% (App and web ↔ With a banker)") reads as if 0% were all app and web
      docHow: 'They pick a point from 0% to 100%: the share of requests and transactions handled without a banker. The screen shows the split, such as 70% without a banker, 30% with a banker.',
      next: 'Next', rule: 'Tap the line',
      data: {
        store: 'digitalShare', numeric: true, min: 0, max: 100, step: 10,
        stops: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => ({ id: String(v), label: v + '%' })),
        readout: '{a}% without a banker · {b}% with a banker',
        ends: ['Without a banker', 'With a banker'],   // the split skin (stretch)
      },
    },
    {
      id: '7.2', kind: 'question', template: 'piles', chapter: 'VII', title: 'Digital features, 12 cards',
      origin: 'Haresh', originText: 'Haresh: "what kind of enhancements need to happen from our digital offering"', min: 1.5,
      question: 'Which digital features does a $5-20mm offer need?',
      instruction: 'Tap a pile for each card. 12 cards.', notes: ['JPOI is the app these clients will use.'],
      next: 'Next', rule: 'Sort all 12 cards',
      data: {
        // v2: a top 3 after all (7.2a), the same rule as the product, service and banker decks (Chris's pattern 1); v1
        // had none (D7)
        store: 'digitalFeatures', shuffle: true, seed: 2720, keys: '1-4', followup: '7.2a',
        piles: PILES_OFFER, ui: PILE_UI,
        cards: [
          { id: 'remote-opening', label: 'Open an account from their phone', hint: 'No meeting needed' },
          { id: 'one-view', label: 'One view of everything with us', hint: 'Across all booking centres' },
          { id: 'aggregation', label: 'See accounts at other banks in JPOI', hint: 'Money held elsewhere' },
          { id: 'in-app-chat', label: 'Message their banker in JPOI' },
          { id: 'whatsapp', label: 'Message their banker on WhatsApp or WeChat', hint: 'Recorded for compliance' },
          { id: 'video', label: 'Video meetings with their banker and specialists' },
          { id: 'fx', label: 'Payments and FX in many currencies' },
          { id: 'credit-line', label: 'A credit line approved in JPOI', hint: 'Against the portfolio' },
          { id: 'self-plan', label: 'A wealth plan they can update themselves' },
          { id: 'ai-assistant', label: 'A 24/7 AI assistant', hint: 'Answers portfolio questions' },
          { id: 'one-login', label: 'One login for JPOI and other J.P. Morgan apps' },
          { id: 'language', label: "JPOI in the client's own language", hint: 'Including statements and alerts' },
        ],
        // a plausible answer, used when 7.2 was not played (7.2a reads its Critical pile)
        sample: { 'remote-opening': 'critical', 'one-view': 'critical', aggregation: 'nice', 'in-app-chat': 'core', whatsapp: 'critical', video: 'core', fx: 'core', 'credit-line': 'critical', 'self-plan': 'nice', 'ai-assistant': 'nice', 'one-login': 'core', language: 'core' },
      },
    },
    {
      id: '7.2a', kind: 'followup', template: 'podium', chapter: 'VII', parent: '7.2', title: 'Top 3 digital features',
      origin: 'Added', originText: 'after Chris (13 Oct, pattern 1): the top-3 rule of 2.1a, 2.3a and 6.3a', min: 0.3,
      bridge: 'The features you put in Critical to winning.',
      // v2: 2.3a's wording. It ranks by importance, as the instruction does, not by build order
      question: 'Which three matter most to winning?',
      instruction: 'Pick your top 3, most important first.', notes: [],
      previewCondition: 'Shows only if Critical holds more than 3 cards.',
      next: 'Next', rule: 'Pick 3',
      data: { store: 'digitalTop3', ui: PODIUM_UI, compact: true, maxPodium: 8, optionsFrom: { step: '7.2', pile: 'critical' }, aboveMax: 'fan' },
    },
    {
      id: '7.3', kind: 'question', template: 'track', chapter: 'VII', title: 'How much AI can do for a banker',
      origin: 'Adam', originText: '11:40', min: 0.45,
      question: 'How much can AI do for an HNW banker, three years after launch?',
      instruction: 'Tap one.',
      notes: ['We mean AI tools that our own staff use.'],
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'aiLevel', missing: 'Tap one',
        stops: [
          { id: 'hardly', label: 'Hardly at all', hint: 'Search and spell-check' },
          { id: 'helper', label: 'A helper', hint: 'Finds things and drafts some notes' },
          { id: 'co-pilot', label: 'A co-pilot', hint: 'Drafts most routine work; the banker checks' },
          { id: 'team-mate', label: 'A team-mate', hint: 'Runs routine work end to end' },
          { id: 'ai-first', label: 'AI first', hint: 'AI runs most work. Bankers handle the big decisions' },
        ],
      },
    },
    {
      id: '7.4', kind: 'question', template: 'stamp', chapter: 'VII', title: 'AI across the client life cycle, 8 cards',
      origin: 'Haresh', originText: 'Haresh: "across the whole life chain of onboarding, KYC, suitability, maintenance"', min: 1.1,
      question: 'Three years after launch, how will people and AI split the work at each step with a client?',
      instruction: 'Stamp each card. 8 cards.',
      notes: ['Think of the work involved, not how much the step matters.'],
      next: 'Next', rule: 'Stamp all 8 cards',
      data: {
        store: 'aiStages', skin: 'ai', shuffle: false, timeline: true, missing: 'Stamp {n} more',
        stamps: [
          { id: 'person', label: 'A person only', impression: 'PERSON' },
          { id: 'person-ai', label: 'A person, with AI help', impression: 'PERSON + AI' },
          { id: 'ai-drafts', label: 'AI drafts, a person checks', impression: 'AI DRAFTS' },
          { id: 'ai', label: 'AI does it, a person spot-checks', impression: 'AI DOES IT' },
        ],
        cards: [
          { id: 'onboarding', label: 'Opening the account', hint: 'Forms, documents, going live' },
          { id: 'kyc', label: 'Checking where the money came from', hint: 'KYC: identity, source of wealth' },
          { id: 'suitability', label: 'Understanding goals and risk appetite', hint: 'Suitability: the risk profile' },
          { id: 'proposal', label: 'Building the first proposal', hint: 'The portfolio and the proposal document' },
          { id: 'meetings', label: 'Preparing for meetings and writing notes', hint: 'Briefing packs and follow-up emails' },
          { id: 'servicing', label: 'Handling requests and paperwork', hint: 'Payments, transfers, statements' },
          { id: 'monitoring', label: 'Watching and adjusting the portfolio', hint: 'Alerts, drift, rebalancing' },
          { id: 'maintenance', label: 'Keeping client records up to date', hint: 'The periodic KYC review' },
        ],
      },
    },
    {
      id: '7.4a', kind: 'followup', template: 'sentence', chapter: 'VII', parent: '7.4', title: 'Clients per banker with AI',
      origin: 'Added', originText: 'R6 §9c', min: 0.25,
      bridge: "Now, what that means for a banker's book.",
      question: 'With the AI you just described, how many clients can one HNW banker cover effectively?',
      instruction: 'Type a number.',
      notes: ['Count relationships (families), not accounts.'],
      next: 'Next', rule: 'Type a number from 10 to 1,000',
      data: {
        store: 'bookWithAi',
        // v2: the same words as 6.1a, so the two compare like with like
        rows: [{ parts: ['One HNW banker can effectively cover about ', { slot: 'number', id: 'n', suffix: ' clients', min: 10, max: 1000, decimals: 0 }, '.'] }],
        checks: [{ when: { slot: 'n', gt: 500 }, text: "That's [N] clients for each banker. Is that right?" }],
        sample: { n: 120 },
      },
    },

    /* ============================== VIII · Price and pay */
    { id: 'break-VIII', kind: 'break', template: 'break', chapter: 'VIII', title: 'Chapter break', origin: 'Added', originText: '§2.5 chapter breaks', min: 0.12, next: 'Next', rule: null, data: {} },
    {
      id: '8.1', kind: 'question', template: 'stamp', chapter: 'VIII', title: 'Changes to price, 12 cards', stage: true,
      origin: 'Adam', originText: 'email; 0:48; 5:47-5:54; 7 cards Added', min: 1.7,
      question: 'Would you make each of these price changes for $5-20mm clients?',
      instruction: 'Stamp each card. {n} cards.',
      notes: ['These changes would apply only to the HNW offer.'],
      previewNote: 'Market managers (wave 2) see 11 cards: no published price list.',
      next: 'Next', rule: 'Stamp all 12 cards',
      data: {
        store: 'pricing', skin: 'tariff', shuffle: true, missing: 'Stamp {n} more', followup: '8.1a',
        vars: { n: { value: 12 } },   // 11 in wave 2
        tariffHeader: 'SCHEDULE OF CHARGES · HNW',
        stamps: STAMPS_DO,
        cards: [
          { id: 'free-online', label: 'Free online trading in shares and ETFs' },
          { id: 'free-all', label: 'Free trading, even through the execution desk' },   // v2: 2.2's words, so the two read together
          { id: 'free-crypto', label: 'Free crypto trading in JPOI' },
          { id: 'promo-deposit', label: 'A launch deposit rate for new money' },
          { id: 'cash-rate', label: 'A market rate on all uninvested cash' },
          { id: 'retros-back', label: 'No retrocessions on any HNW account', hint: 'Clean share classes only, even where the law allows retrocessions' },
          { id: 'all-in', label: 'One yearly fee for advice, custody and trading' },
          { id: 'membership', label: 'A flat yearly membership fee', hint: 'Instead of a % of assets' },
          { id: 'price-list', label: 'A published price list bankers cannot discount', sensitive: true },
          { id: 'relationship-lending', label: 'Lending priced on the whole relationship', hint: 'Lower rates as total balances with us grow' },
          { id: 'no-fx-markup', label: 'No mark-up on currency exchange' },
          { id: 'no-custody', label: 'No custody fee' },
        ],
        sample: { 'free-online': 'do', 'free-all': 'never', 'free-crypto': 'never', 'promo-deposit': 'pilot', 'cash-rate': 'do', 'retros-back': 'pilot', 'all-in': 'pilot', membership: 'never', 'price-list': 'never', 'relationship-lending': 'do', 'no-fx-markup': 'pilot', 'no-custody': 'do' },
      },
    },
    {
      id: '8.1a', kind: 'followup', template: 'stamp', chapter: 'VIII', parent: '8.1', title: 'Only one change', stage: true,
      origin: 'Added', originText: 'draft C F1.one', min: 0.3,
      bridge: "We can't do everything at once.",
      question: 'If we could make only one of these changes, which one?',
      instruction: 'Tap one line.', notes: [],
      previewCondition: 'Shows only if two or more cards are stamped Do it or Pilot it.',
      next: 'Next', rule: 'Tap one line',
      data: {
        store: 'pricingOne', mode: 'pick-line', skin: 'tariff', tariffHeader: 'SCHEDULE OF CHARGES · HNW',
        // laptop: the tariff card itself; lines stamped Do it or Pilot it stay in ink and are tappable, the rest grey.
        // phone: the stamped cards as compact chips in two columns, Do it first, each tagged.
        optionsFrom: { step: '8.1', stamps: ['do', 'pilot'] },
        phoneTags: { do: 'Do it', pilot: 'Pilot' },
      },
    },
    {
      id: '8.2', kind: 'question', template: 'checklist', chapter: 'VIII', title: 'How HNW bankers are paid', sensitive: true,
      origin: 'Adam', originText: 'email', min: 0.45,
      question: 'How would you mainly pay HNW bankers?',
      instruction: 'Tap one.', notes: [],
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'payModel', mode: 'one', shuffle: true, missing: 'Tap one',
        options: [
          { id: 'scorecard', label: 'Salary and a bonus on a scorecard', hint: 'Judged on several measures' },
          { id: 'formula', label: 'Salary and a bonus by formula', hint: 'A share of revenue above a hurdle' },
          { id: 'grid', label: 'A production grid', hint: 'A set share of the revenue they bring' },
          { id: 'team-pool', label: 'A team pool', hint: 'Shared by banker and specialists' },
          { id: 'salary', label: 'Mostly salary', hint: 'A small bonus for service' },
        ],
      },
    },
    {
      id: '8.2a', kind: 'followup', template: 'checklist', chapter: 'VIII', parent: '8.2', title: 'Comp 2.0', sensitive: true,
      origin: 'Adam', originText: 'email; meaning Assumed', min: 0.3,
      bridge: 'About Comp 2.0.',
      question: 'Would Comp 2.0 work for HNW bankers?',
      instruction: 'Tap one.', notes: [],
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'comp2', mode: 'one', shuffle: false, missing: 'Tap one',
        options: [
          { id: 'as-is', label: 'Yes, as it is' },
          { id: 'adapted', label: 'Yes, adapted for HNW' },
          { id: 'own-plan', label: 'No, HNW needs its own plan' },
          { id: 'dont-know', label: "I don't know it well enough", pinned: true },
        ],
        // used only if Comp 2.0 may not be named (D13); the option ids here are the preview's own
        fallback: {
          bridge: 'About the pay plan.',
          question: 'Would one pay plan work for both HNW and UHNW bankers?',
          options: [
            { id: 'same', label: 'Yes, the same plan' },
            { id: 'same-hnw-measures', label: 'The same plan, with HNW measures' },
            { id: 'separate', label: 'A separate plan for HNW' },
          ],
        },
      },
    },
    {
      id: '8.3', kind: 'question', template: 'stamp', chapter: 'VIII', title: 'Changes to pay, 5 cards', sensitive: true,
      origin: 'Adam', originText: '5:47 "controversial questions on fees and comp"; cards Added (R4 §4.2, §4.4)', min: 0.9,
      question: "Where do you stand on each of these changes to HNW bankers' pay?",
      instruction: 'Stamp each card. 5 cards.',
      notes: ["UHNW bankers' pay is not part of this question."],
      next: 'Next', rule: 'Stamp all 5 cards',
      data: {
        store: 'payMoves', skin: 'plain', shuffle: true, missing: 'Stamp {n} more',
        stamps: STAMPS_DO,
        cards: [
          { id: 'team-pay', label: 'Pay HNW bankers as a team, not individually' },
          { id: 'salary-only', label: 'Mostly salary, with no sales bonus' },
          { id: 'nnm-bonus', label: 'Bonus on net new money, not revenue' },
          { id: 'hire-guarantee', label: 'Guaranteed pay to hire bankers with books', hint: 'First-year packages for lateral hires' },
          { id: 'satisfaction-bonus', label: 'A bonus mostly on client satisfaction' },
        ],
      },
    },
    {
      id: '8.4', kind: 'question', template: 'checklist', chapter: 'VIII', title: 'Reward for passing a client to UHNW', sensitive: true,
      origin: 'Adam', originText: 'email', min: 0.45,
      // v2: the opening fits all seven answers; two of them (the banker moves up, no handover) are not rewards
      question: "A banker's client grows into UHNW. What would you do for the banker?",
      instruction: 'Tap one.', notes: [],
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'referUp', mode: 'one', shuffle: false, missing: 'Tap one',   // fixed order, least to most
        options: [
          { id: 'scorecard-only', label: 'Scorecard credit for net new money, no cash' },
          { id: 'one-off', label: 'A one-off payment at handover' },
          { id: 'trailer', label: 'A revenue share for some years' },
          { id: 'dual', label: 'Both bankers get full credit for a set time' },
          { id: 'shared', label: 'Shared credit while the client stays' },
          { id: 'moves-up', label: 'The banker moves to UHNW with the client' },
          { id: 'no-handover', label: 'No handover. UHNW specialists join the team' },
        ],
        sample: 'trailer',
      },
    },
    {
      id: '8.4a', kind: 'followup', template: 'track', chapter: 'VIII', parent: '8.4', title: 'Revenue-share years', sensitive: true,
      origin: 'Adam', originText: 'email, "multi-year trailer"', min: 0.1,
      bridge: 'On the revenue share.',
      question: 'How long would you pay it for?',
      instruction: 'Tap one.', notes: [],
      previewCondition: 'Shows only if the answer to 8.4 is A revenue share for some years.',
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'referUpYears', missing: 'Tap one',
        stops: [
          { id: '1', label: '1 year' },
          { id: '2', label: '2 years' },
          { id: '3', label: '3 years' },
          { id: '4-5', label: '4-5 years' },
          { id: '5+', label: 'More than 5 years' },
        ],
      },
    },
    {
      id: '8.4b', kind: 'followup', template: 'track', chapter: 'VIII', parent: '8.4', title: 'Credit for referrals in', sensitive: true,
      origin: 'Added', originText: 'R4 §4.5-4.6; R11 §6.3', min: 0.35,
      bridge: 'Referrals the other way, into HNW.',
      question: 'A colleague from another J.P. Morgan business refers a $5-20mm client to us. What credit would the referral earn?',
      instruction: 'Tap one.',
      notes: ["Within each market's referral rules."],
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'referIn', missing: 'Tap one', labelsUnder: true,
        stops: [
          { id: 'nothing', label: "Nothing. It's part of the job" },
          { id: 'scorecard', label: "Credit on the colleague's scorecard" },
          { id: 'one-off', label: "A one-off credit to the colleague's business" },
          { id: 'years', label: 'Revenue credit to that business for some years' },
          { id: 'shared', label: 'Shared credit between the businesses while the client stays' },
        ],
      },
    },

    /* ============================== IX · What it takes to win */
    { id: 'break-IX', kind: 'break', template: 'break', chapter: 'IX', title: 'Chapter break', origin: 'Added', originText: '§2.5 chapter breaks', min: 0.12, next: 'Next', rule: null, data: {} },
    {
      id: '9.1', kind: 'question', template: 'rank', chapter: 'IX', title: 'What is critical to win', stage: true,
      origin: 'Adam', originText: 'email; 2:54-3:16; 6:20; 13:06-13:56', min: 2.0,
      question: 'What is most critical to winning $5-20mm clients?',
      instruction: 'Place all 10. Most important at 1.', notes: [],
      next: 'Next', rule: 'Place all 10',
      data: {
        store: 'win', shuffle: true, ui: RANK_UI, blocks: WIN_BLOCKS,
        sample: ['talent', 'service-model', 'onboarding', 'products', 'digital', 'pay', 'referrals', 'pricing', 'training', 'bandwidth'],
      },
    },
    {
      id: '9.2', kind: 'question', template: 'stamp', chapter: 'IX', title: 'Where the IPB is today on each',
      origin: 'Added', originText: '1:38; draft C T2', min: 1.0,
      question: 'Where does the IPB stand on each of these today?',
      instruction: 'Stamp each card. 10 cards.',
      notes: [],
      next: 'Next', rule: 'Stamp all 10 cards',
      data: {
        store: 'ready', skin: 'readiness', shuffle: true, seed: 2920, missing: 'Stamp {n} more',
        stamps: [
          { id: 'ready', label: 'Ready now', impression: 'READY', glyph: 'tick' },
          { id: 'fixable', label: 'Fixable within a year', impression: 'WITHIN A YEAR', glyph: 'half' },
          { id: 'gap', label: 'Needs more than a year', impression: 'MORE THAN A YEAR', glyph: 'cross' },
        ],
        cards: WIN_BLOCKS,   // the ten 9.1 blocks, same labels and hints, fresh shuffle
      },
    },
    {
      id: '9.3', kind: 'question', template: 'checklist', chapter: 'IX', title: 'Under which name',
      origin: 'Added', originText: 'R0 §5; R2 §7.6', min: 0.35,
      question: 'Under which name would you serve $5-20mm clients?',
      instruction: 'Tap one.', notes: [],
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'brand', mode: 'one', shuffle: true, missing: 'Tap one',
        options: [
          { id: 'private-bank', label: 'J.P. Morgan Private Bank', hint: 'The same name as for UHNW clients' },
          { id: 'named-tier', label: 'A named tier inside the Private Bank', hint: 'Its own name, the Private Bank behind it' },
          { id: 'private-client', label: 'J.P. Morgan Private Client', hint: 'The name used in the US' },
          { id: 'new-name', label: 'A new name of its own' },
        ],
      },
    },
    // v3: 9.3a (which app) is gone. Adam, 15 Oct: "we will use JPOI. We can skip that."
    {
      id: '9.4', kind: 'question', template: 'sentence', chapter: 'IX', title: 'Clients in five years, IPB-wide',
      origin: 'Added', originText: '1:24; 12:22', min: 0.45,
      // v2: the same words as 5.4, so the three-year and five-year numbers read as growth
      question: 'Five years after launch, I expect the IPB to have about [      ] clients with $5-20mm.', questionIsObject: true,
      instruction: 'Type a number.',
      notes: ['Relationships (families), not accounts.'],
      next: 'Next', rule: 'Type a number from 0 to 200,000',
      data: {
        store: 'ambition',
        rows: [{ parts: ['Five years after launch, I expect the IPB to have about ', { slot: 'number', id: 'n', min: 0, max: 200000, step: 500, decimals: 0, wide: true }, ' clients with $5-20mm.'] }],
        checks: [{ when: { slot: 'n', gt: 75000 }, text: '[N] client families across the whole IPB. Is that the figure you meant?' }],
      },
    },
    {
      id: '9.4a', kind: 'followup', template: 'track', chapter: 'IX', parent: '9.4', title: 'Years to break even',
      origin: 'Added', originText: 'draft A IX.5', min: 0.2,
      bridge: 'This will take investment.',
      question: 'How many years would you give the HNW business to break even?',
      instruction: 'Tap one.',
      notes: ['Break even means the first full year in which revenue covers all costs, bankers and technology included.'],
      next: 'Next', rule: 'Tap one',
      data: {
        store: 'breakeven', missing: 'Tap one',
        stops: [
          { id: '1-2', label: '1-2 years' },
          { id: '3', label: '3 years' },
          { id: '4', label: '4 years' },
          { id: '5', label: '5 years' },
          { id: '6-7', label: '6-7 years' },
          { id: '8-10', label: '8-10 years' },
          { id: '10+', label: 'More than 10 years' },
        ],
      },
    },
    {
      id: '9.4b', kind: 'followup', template: 'checklist', chapter: 'IX', parent: '9.4', title: 'Client market to start with',
      origin: 'Added', originText: 'R0 §5; R11 §1.2', min: 0.35,
      bridge: 'Where to begin.',
      question: 'Which client market would you start with?',
      instruction: 'Tap one.',
      notes: ['Where the clients live, not where they are booked.'],
      previewNote: "Markets will come from the roster's IPB list; these are the design's stand-in.",
      docHow: "Pick a region, then a market in it, or type another market. The markets shown are examples until the IPB's own list is confirmed.",
      next: 'Next', rule: 'Tap a region, then a market (or Another market, then type it)',
      data: {
        store: 'launchFirst', mode: 'region-market', missing: 'Tap one',
        regions: [
          { id: 'asia', label: 'Asia', markets: ['Hong Kong', 'Singapore', 'Mainland China', 'Australia'] },
          { id: 'emea', label: 'Europe, Middle East and Africa', markets: ['United Kingdom', 'Switzerland', 'Germany', 'France', 'Italy', 'Spain', 'United Arab Emirates', 'Saudi Arabia'] },
          { id: 'latam', label: 'Latin America', markets: ['Brazil', 'Mexico', 'Argentina', 'Chile', 'Colombia', 'Peru'] },
        ],
        other: { id: 'other', label: 'Another market', pinned: true, field: { limit: 40 } },
      },
    },

    /* ============================== X · Your view */
    { id: 'break-X', kind: 'break', template: 'break', chapter: 'X', title: 'Chapter break', origin: 'Added', originText: '§2.5 chapter breaks', min: 0.12, next: 'Next', rule: null, data: {} },
    {
      id: '10.1', kind: 'question', template: 'text', chapter: 'X', title: 'Excited and nervous',
      origin: 'Adam', originText: 'email; 7:12-7:21', min: 1.8,
      question: 'What excites you most about this, and what makes you most nervous?',
      instruction: 'Write a sentence or two in each.', notes: [],
      next: 'Next', rule: 'Write at least 3 characters in each note',
      data: {
        store: 'feel', counterFrom: 0.8, phoneNext: 'Next note',
        fields: [
          { id: 'excited', stem: 'What excites me most is…', limit: 280, required: true, min: 3 },
          { id: 'nervous', stem: 'What makes me most nervous is…', limit: 280, required: true, min: 3 },
        ],
      },
    },
    {
      id: '10.2', kind: 'question', template: 'text', chapter: 'X', title: 'What we will get wrong again',
      origin: 'Adam', originText: 'email; 7:14', min: 1.6,
      question: 'What do you fear we will get wrong again?',
      instruction: 'Write as much as you like.',
      notes: ['Think of earlier attempts to serve these clients, here or at other banks.'],
      next: 'Next', rule: 'Write at least 3 characters',
      data: {
        store: 'fear', counterFrom: 0.8,
        fields: [{ id: 'fear', stem: 'What I fear we will get wrong again is…', limit: 600, required: true, min: 3 }],
      },
    },
    {
      id: '10.3', kind: 'question', template: 'text', chapter: 'X', title: 'The competitor that does this best',
      origin: 'Adam', originText: 'email; 7:21', min: 0.6,
      question: 'The competitor that does this best is ________.', questionIsObject: true,
      instruction: 'Type a name, and say why if you like.', notes: [],
      next: 'Next', rule: 'Type a name (the why is optional)',
      data: {
        store: 'rival', counterFrom: 0.8,
        sentence: { pre: 'The competitor that does this best is', post: '.', field: 'name' },
        fields: [
          { id: 'name', kind: 'line', inSentence: true, limit: 60, required: true, min: 1 },
          { id: 'why', stem: "What they do that we don't is…", limit: 200, required: false },
        ],
        // v3: the chip writes 'no one' in the blank, so the sentence reads "...does this best is no one."
        chip: { label: 'No one does it well', fills: 'name', value: 'no one' },
        typeaheadAfter: 2,
        // suggestions come from the respondent's region (roster); the preview has no region, so it may merge all three
        typeahead: {
          asia: ['HSBC', 'Standard Chartered', 'DBS', 'Citi', 'UBS', 'Julius Baer', 'Bank of Singapore', 'OCBC', 'UOB', 'Hang Seng', 'LGT', 'BNP Paribas', 'Morgan Stanley', 'Goldman Sachs', 'Futu', 'Tiger Brokers', 'Interactive Brokers'],
          emea: ['UBS', 'HSBC', 'Barclays', 'Coutts', 'Julius Baer', 'Pictet', 'Lombard Odier', 'Rothschild & Co', 'Deutsche Bank', 'BNP Paribas', 'Citi', 'Standard Chartered', 'Santander', 'BBVA', 'Emirates NBD', 'First Abu Dhabi Bank', 'Saudi National Bank', 'Al Rajhi', 'QNB', 'Mashreq', 'Revolut', 'Saxo', 'Interactive Brokers'],
          latam: ['Itaú', 'BTG Pactual', 'XP', 'Bradesco', 'Safra', 'Santander', 'BBVA', 'Banorte', 'Banco de Chile', 'Bci', 'Bancolombia', 'Credicorp', 'Citi', 'UBS', 'Morgan Stanley', 'Nubank'],
        },
      },
    },
    {
      id: '10.4', kind: 'question', template: 'text', chapter: 'X', title: "Anything we didn't ask (optional)",
      origin: 'Added', originText: 'drafts A X.5, B 12.4, C E8', min: 0.4,
      question: "Is there anything we didn't ask, or one thing you'd change about the HNW plan?",
      instruction: 'Optional. A line or two.', notes: [],
      next: 'Next', rule: 'Optional (Next reads Skip while empty)',
      data: {
        store: 'last', counterFrom: 0.8, optional: true, emptyLabel: 'Skip',
        fields: [{ id: 'last', limit: 400, required: false }],
      },
    },
    {
      id: 'pause', kind: 'pause', template: 'flow', chapter: 'X', title: 'Pause card',
      origin: 'Added', originText: 'time review (RX-23)', min: 0.1,
      next: 'Next', rule: null,
      data: { variant: 'pause', line: "All that's left is a newspaper front page.", later: 'Continue later', toast: 'Saved. Open the same link to continue on any device.' },
    },
    {
      id: '10.5', kind: 'question', template: 'newspaper', chapter: 'X', title: 'The front page: headline and quote', stage: true,
      origin: 'Adam', originText: 'email; 7:27-7:29; Haresh', min: 3.0,
      question: 'When we launch, what headline would you like to see in your local newspaper?',
      instruction: 'Type your headline. It appears on the page.', notes: [],
      next: 'Send', rule: 'A headline and a quote, 10 characters or more each',
      data: {
        store: 'paper',
        // two steps on one screen; the quote step opens once the headline has 10 or more characters
        steps: [
          { bridge: '', question: 'When we launch, what headline would you like to see in your local newspaper?', instruction: 'Type your headline. It appears on the page.', notes: [] },
          { bridge: 'Then a quote from you.', question: 'What quote in that same article would you like attributed to you?', instruction: 'Type your quote. It appears on the page.', notes: [] },
        ],
        // v2 (Haresh, 14 Oct): just the headline and the quote. No choice of city paper (the city mastheads caused layout
        // problems) and no name or title (the unique link already says who answered): one fixed front page
        labels: { headline: 'Headline', quote: 'Quote' },
        marks: ['“', '”'],
        page: {
          masthead: 'The Ledger',
          ears: ['LAUNCH EDITION', 'PRIVATE BANKING'],
          folio: 'Vol. I · No. 1 · Launch day',
          kicker: 'PRIVATE BANKING',
          headlinePlaceholder: 'Your headline',
          quotePlaceholder: 'Your quote',
          byline: '— J.P. Morgan Private Bank',
          footer: 'Ceres · internal survey · not a real newspaper',
        },
        limits: { headline: { soft: 90, hard: 110, counterFrom: 80, min: 10 }, quote: { soft: 180, hard: 220, min: 10 } },
        counter: '{n} / {soft}', counterLong: '{n} / {soft} · long',   // over the soft limit
        missing: { headline: 'Write your headline', headlineShort: 'Headline: {n} more characters', quote: 'Write your quote', quoteShort: 'Quote: {n} more characters' },
      },
    },
    {
      id: 'end', kind: 'ending', template: 'flow', chapter: null, title: 'Ending and contact line',
      origin: 'Adam', originText: '12:22-12:44', min: 0.3,
      next: null, rule: null,
      data: {
        variant: 'ending',
        wreathLabel: 'WHAT YOU SAID IT TAKES',
        thanks: "Thank you. That's everything.",
        sent: 'Your answers have been sent.',
        contact: 'We may contact you about some of your responses.',
        sendFailure: "Couldn't send. Tap to try again.",
        top3From: '9.1',                                    // the respondent's own top three from 9.1
        sampleTop3: ['talent', 'service-model', 'onboarding'],
      },
    },
  ]

  /* ------------------------------------------------------------------ templates */

  // Template name -> page, what it draws, and the mockup it ports. One page per template: t-<template>.html.
  const templates = {
    flow: { page: 't-flow.html', what: 'Welcome, 0.1 opening statement and ruler, pause card, ending', mockup: 'index.html' },
    break: { page: 't-break.html', what: 'Chapter break card with the chapter map', mockup: 'index.html' },
    // v3: no step uses the one-word plaque (blank) or the keep step any more; t-blank.html and t-keep.html stay in the
    // preview only so an old link lands on its step
    piles: { page: 't-piles.html', what: 'PileSort, four piles of one size (2.2, 2.5, 6.3, 7.2); card groups on 2.5; Undo, and Change on a pile', mockup: 'piles.html' },
    configure: { page: 't-configure.html', what: 'Three ways of investing, one at a time, three parts each: where it belongs, products it covers, who helps (2.3)', mockup: 'none' },
    podium: { page: 't-podium.html', what: 'Top 3 podium of compact tiles; fan pick above 8 (3.2, 2.2a, 2.5a, 6.3a, 7.2a)', mockup: 'piles.html (podium)' },
    trays: { page: 't-trays.html', what: 'Four trays (2.6) or three (5.3), with counts', mockup: 'none (design §4)' },
    ladder: { page: 't-ladder.html', what: 'Share-of-wallet glass column, three internal steps (3.1)', mockup: 'wallet.html' },
    rank: { page: 't-rank.html', what: 'Stack of ten, true 1-10 rank (3.3, 9.1)', mockup: 'rank.html' },
    sentence: { page: 't-sentence.html', what: 'Sentence with typed numbers and word chips (4.1, 4.2, 4.3a, 5.4, 6.1a, 6.2, 6.4a, 7.4a, 9.4); two numbers on 6.2', mockup: 'none (design §4)' },
    checklist: { page: 't-checklist.html', what: 'Tap one / pick one or two / pictures / region then market / a choice of two (1.1-1.4, 2.4a)', mockup: 'ledger.html (5.2a list)' },
    stamp: { page: 't-stamp.html', what: 'Stamp deck; tariff skin and line pick (4.3, 7.4, 8.1, 8.1a, 8.3, 9.2)', mockup: 'none (design §4)' },
    'allocate-ledger': { page: 't-allocate-ledger.html', what: 'The $10mm ledger (5.1, 5.2)', mockup: 'ledger.html' },
    'allocate-list': { page: 't-allocate-list.html', what: 'Typed shares to 100%, shown as clients of the 5.4 number (5.4a)', mockup: 'ledger.html (cells and footer)' },
    track: { page: 't-track.html', what: 'Ordered stops on a line (2.4, 6.2b, 7.1, 7.3, 8.4a, 8.4b, 9.4a); labels at the ends on 2.4 and 7.1', mockup: 'none (design §4)' },
    bottle: { page: 't-bottle.html', what: 'Four jugs, 10 bankers (6.4)', mockup: 'none (The Ascent bottle)' },
    text: { page: 't-text.html', what: 'Three client quotes (2.1); ruled notes and the competitor sentence (10.1-10.4)', mockup: 'none (design §4)' },
    newspaper: { page: 't-newspaper.html', what: 'Live front page, one fixed paper: headline and quote only (10.5)', mockup: 'newspaper.html' },
  }

  // Interface lines the frame and the break card use (deck: "Rail and shared interface labels", "Chapter breaks").
  // The preview rail shows "Question n of 42" and a Contents link in place of time left and the Saved tick, since
  // nothing is saved; the survey's own lines are kept here so they stay reviewable.
  const ui = {
    back: '‹ Back',
    timeLeft: 'about {n} min left', timeLeftLow: 'under 5 min left',
    saved: 'Saved ✓', notSaved: 'Not saved yet',
    menu: ['Continue later', 'Chapter map'],
    next: 'Next',
    breakMinutes: 'About {n} minutes',
    breakMinute: 'About {n} minute',   // v3: chapter I is about 1 minute
    mapStates: { done: '✓ done', now: 'now', later: 'about {n} min' },
    later: 'Continue later',
    laterToast: 'Saved. Open the same link to continue on any device.',
    laterToastFallback: 'Saved. Open the same link to continue in this browser.',
    missing: { piles: 'Sort {n} more', pick: ['Pick 3', 'Pick {n} more'], place: 'Place {n} more', stamps: 'Stamp {n} more', tapOne: 'Tap one', jugs: 'Add {n} more', optional: 'Skip', blank: 'Type one word' },
  }

  window.CERES_SCRIPT = {
    ui,
    version: "design v3 + copy deck, 10 Oct 2026; preview script 11 Oct 2026; v2 after Chris's review, 13 Oct 2026 (questionnaire v2, 14 Oct 2026); v3 after Adam's and Chris's notes, 15 Oct 2026",
    context: CONTEXT,
    sampleNote: CTX_SAMPLE_NOTE,
    chapters,
    steps,
    templates,
  }
})()
