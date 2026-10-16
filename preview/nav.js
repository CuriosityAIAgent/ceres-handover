/* Ceres review preview: navigation, numbering and the reviewer's own answers.
   Classic script (works from file:// and over http). Needs script.js first.

   CeresNav.steps                 every step, in play order
   CeresNav.step(id)              the step object (or null)
   CeresNav.next(id) / prev(id)   the id after / before, or null at the ends
   CeresNav.href(step|id)         't-<template>.html?id=<id>' (relative)
   CeresNav.go(id)                navigate to that step's page
   CeresNav.currentId()           ?id= from the URL, else the first step
   CeresNav.current()             the step object for currentId()
   CeresNav.number(step|id)       question number 1-42 (follow-ups share their parent's); null for other steps
   CeresNav.chapter(step|id)      the chapter object ({ numeral, name, line, minutes, dots, index }) or null
   CeresNav.dots(step|id)         { total, on, sub } for the rail: one dot per question screen in the chapter;
                                  on = index of the current question screen (-1 before the first); sub = a follow-up
   CeresNav.done(step|id)         chapters finished before this step (ripe stalks in the sheaf)
   CeresNav.answers.get(id) / set(id, value) / clear(id) / clearAll() / all()
                                  the reviewer's own answers, in localStorage, keyed by step id (memory fallback)
   CeresNav.value(id)             { value, sample } : the reviewer's answer, else step.data.sample (sample: true)
   CeresNav.resolveVars(step)     { X: '5', ... } from step.data.vars (earlier answers or their samples)
   CeresNav.fill(text, vars)      replaces [X] / {n} style placeholders
*/
(function () {
  'use strict'
  const S = window.CERES_SCRIPT
  if (!S) { console.error('CeresNav: load script.js before nav.js'); return }
  const steps = S.steps
  const byId = Object.create(null)
  steps.forEach((s, i) => { s.index = i; byId[s.id] = s })
  const chapters = S.chapters.map((c, i) => Object.assign({ index: i }, c))
  const chapterBy = Object.create(null)
  chapters.forEach((c) => { chapterBy[c.numeral] = c })

  const as = (x) => (typeof x === 'string' ? byId[x] || null : x || null)

  // question numbering: 1..42 in play order
  const qNum = Object.create(null)
  let n = 0
  steps.forEach((s) => { if (s.kind === 'question') qNum[s.id] = ++n })

  function step(id) { return byId[id] || null }
  function next(id) { const s = as(id); return s && s.index < steps.length - 1 ? steps[s.index + 1].id : null }
  function prev(id) { const s = as(id); return s && s.index > 0 ? steps[s.index - 1].id : null }
  function href(x) { const s = as(x); return s ? 't-' + s.template + '.html?id=' + encodeURIComponent(s.id) : 'index.html' }
  function go(id) { if (id == null) return; const s = as(id); if (s) window.location.href = href(s) }
  function currentId() {
    let id = null
    try { id = new URLSearchParams(window.location.search).get('id') } catch (e) { id = null }
    return id && byId[id] ? id : steps[0].id
  }
  function current() { return byId[currentId()] }
  function number(x) {
    const s = as(x); if (!s) return null
    if (s.kind === 'question') return qNum[s.id]
    if (s.kind === 'followup' && s.parent) return qNum[s.parent] || null
    return null
  }
  function chapter(x) { const s = as(x); return s && s.chapter ? chapterBy[s.chapter] || null : null }
  function dots(x) {
    const s = as(x); const c = chapter(s)
    if (!c) return { total: 0, on: -1, sub: false }
    const qs = steps.filter((t) => t.kind === 'question' && t.chapter === c.numeral)
    let on = -1
    if (s.kind === 'question') on = qs.indexOf(s)
    else if (s.kind === 'followup') on = qs.indexOf(byId[s.parent])
    else if (s.kind === 'break') on = -1
    else { // the pause card: every question screen before it in the chapter is done
      on = qs.filter((q) => q.index < s.index).length - 1
    }
    return { total: qs.length, on, sub: s.kind === 'followup' }
  }
  function done(x) {
    const s = as(x); if (!s) return 0
    if (s.kind === 'ending') return chapters.length
    const c = chapter(s)
    return c ? c.index : 0
  }

  /* ---------------- answers (the reviewer's own; never sent anywhere) ---------------- */
  // v3 (15 Oct): a new namespace again, since the numbers moved (chapter I lost its two typed words, chapter II gained
  // 2.1 and 2.4): an answer saved against a v2 number must never fill a different v3 question
  const PREFIX = 'ceres-preview-v3:'
  const mem = Object.create(null)
  let store = null
  try { store = window.localStorage; const k = PREFIX + '__t'; store.setItem(k, '1'); store.removeItem(k) } catch (e) { store = null }
  const answers = {
    get(id) {
      if (store) { try { const v = store.getItem(PREFIX + id); return v == null ? undefined : JSON.parse(v) } catch (e) { return undefined } }
      return mem[id]
    },
    set(id, value) {
      if (value === undefined) return answers.clear(id)
      if (store) { try { store.setItem(PREFIX + id, JSON.stringify(value)); return } catch (e) { /* fall through */ } }
      mem[id] = value
    },
    clear(id) { if (store) { try { store.removeItem(PREFIX + id) } catch (e) { /* ignore */ } } delete mem[id] },
    clearAll() {
      steps.forEach((s) => answers.clear(s.id))
    },
    all() { const o = {}; steps.forEach((s) => { const v = answers.get(s.id); if (v !== undefined) o[s.id] = v }); return o },
  }
  function value(id) {
    const v = answers.get(id)
    if (v !== undefined && v !== null && v !== '') return { value: v, sample: false }
    const s = byId[id]
    return { value: s && s.data ? s.data.sample : undefined, sample: true }
  }

  /* ---------------- placeholders ---------------- */
  // a whole number of 1,000 or more takes the thousands comma (5.4a: "Where will those 3,000 clients come from?")
  const trim0 = (x) => { const v = Math.round(x * 10) / 10; return Math.abs(v) >= 1000 && v === Math.round(v) ? v.toLocaleString('en-GB') : String(v) }
  function resolveVars(x) {
    const s = as(x); const out = {}; let usedSample = false
    const vars = (s && s.data && s.data.vars) || {}
    Object.keys(vars).forEach((k) => {
      const d = vars[k]
      if (d.value != null) { out[k] = String(d.value); return }   // a constant, e.g. 8.1's {n}
      const got = answers.get(d.from)
      let raw = got && typeof got === 'object' ? got[d.key] : got
      if (raw === undefined || raw === null || raw === '' || isNaN(+raw)) { raw = d.sample; usedSample = true }
      let v = +raw
      if (d.compute === 'rest-of-10') v = Math.max(0, 10 - v)
      out[k] = d.format === 'mm1' ? v.toFixed(1) : trim0(v)
    })
    Object.defineProperty(out, '_sample', { value: usedSample, enumerable: false })
    return out
  }
  function fill(text, vars) {
    if (text == null) return text
    return String(text).replace(/\[([A-Z])\]|\{([a-zA-Z]+)\}/g, (m, a, b) => {
      const k = a || b
      return vars && vars[k] != null ? String(vars[k]) : m
    })
  }

  /* ---------------- self-check (the counts in script.js's header, v3) ---------------- */
  const EXPECT = { question: 42, followup: 21, break: 10, all: 77,
    conditional: ['2.2a', '2.4a', '2.5a', '4.3a', '5.4a', '6.2a', '6.3a', '7.2a', '8.1a', '8.4a'] }
  function selfCheck() {
    const count = (k) => steps.filter((s) => s.kind === k).length
    const c = { question: count('question'), followup: count('followup'), break: count('break'), all: steps.length }
    const condIds = steps.filter((s) => s.kind === 'followup' && s.previewCondition).map((s) => s.id)
    const cond = condIds.length
    const ok = c.question === EXPECT.question && c.followup === EXPECT.followup && c.break === EXPECT.break &&
      c.all === EXPECT.all && condIds.join(' ') === EXPECT.conditional.join(' ')
    if (!ok) console.warn('CeresNav: unexpected step counts', c, 'conditional', condIds.join(' '))
    const ids = new Set()
    steps.forEach((s) => { if (ids.has(s.id)) console.warn('CeresNav: duplicate id', s.id); ids.add(s.id) })
    return Object.assign(c, { conditional: cond, ok })
  }

  window.CeresNav = {
    steps, chapters, step, next, prev, href, go, currentId, current, number, chapter, dots, done,
    answers, value, resolveVars, fill, selfCheck,
    total: n,
  }
  selfCheck()
})()
