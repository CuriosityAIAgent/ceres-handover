/* Ceres review preview: the shared frame.
   Copied from mockups/ceres-frame.js (the rail and the sheaf, unchanged; the mockup index is dropped) and extended with
   window.CeresPreview, which builds the whole preview frame for a step: the preview banner, the rail, the question
   band, the object container and the Next bar. Plain JS, no build step, classic <script> (works from file://).
   Load order on every page: preview.css, script.js, nav.js, frame.js, then the page's own script.

   const step = CeresNav.current()
   const ui = CeresPreview.mount(step, { stage: true })
   ui.obj.innerHTML = '...'            // draw the object from step.data
   ui.status(false, 'Sort 7 more')     // incomplete: "In the survey: Sort 7 more" beside Next (Next still works)
   ui.status(true)                     // complete: the hint goes
   ui.save(answer)                     // the reviewer's own answer, in localStorage under the step id
   See CONTRACT.md for the full API. */
(function () {
  const NS = 'http://www.w3.org/2000/svg'

  /* =========================================================== from ceres-frame.js */

  /** A fanned sheaf: one stalk per chapter reached. Finished stalks are harvest gold, the current one olive outline. */
  function sheaf(done, current, opts) {
    const o = Object.assign({ w: 120, h: 30, total: 10 }, opts || {})
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', '0 0 120 34')
    svg.setAttribute('width', o.w)
    svg.setAttribute('height', o.h)
    svg.setAttribute('class', 'c-sheaf')
    svg.setAttribute('aria-hidden', 'true')
    const n = Math.min(o.total, done + (current ? 1 : 0))
    const baseX = 60, baseY = 33
    for (let i = 0; i < o.total; i++) {
      if (i >= n) continue
      const ripe = i < done
      const a = (i - (n - 1) / 2) * 8 * Math.PI / 180  // fan centred on upright, so one stalk stands straight
      const len = 25
      const tx = baseX + Math.sin(a) * len, ty = baseY - Math.cos(a) * len
      const g = document.createElementNS(NS, 'g')
      const stem = document.createElementNS(NS, 'line')
      stem.setAttribute('x1', baseX); stem.setAttribute('y1', baseY)
      stem.setAttribute('x2', tx); stem.setAttribute('y2', ty)
      stem.setAttribute('stroke', ripe ? '#8A6116' : '#5B6631')
      stem.setAttribute('stroke-width', '1.1')
      g.appendChild(stem)
      // the ear: three pairs of grains along the last part of the stalk
      for (let k = 0; k < 3; k++) {
        const t = 0.62 + k * 0.13
        const cx = baseX + Math.sin(a) * len * t, cy = baseY - Math.cos(a) * len * t
        for (const side of [-1, 1]) {
          const e = document.createElementNS(NS, 'ellipse')
          const deg = (a * 180 / Math.PI) + side * 28
          e.setAttribute('cx', cx + side * 1.6 * Math.cos(a))
          e.setAttribute('cy', cy + side * 1.6 * Math.sin(a))
          e.setAttribute('rx', '1.3'); e.setAttribute('ry', '2.6')
          e.setAttribute('transform', `rotate(${deg} ${cx + side * 1.6 * Math.cos(a)} ${cy + side * 1.6 * Math.sin(a)})`)
          e.setAttribute('fill', ripe ? '#D2A94E' : 'none')
          e.setAttribute('stroke', ripe ? '#8A6116' : '#5B6631')
          e.setAttribute('stroke-width', '0.7')
          g.appendChild(e)
        }
      }
      const tip = document.createElementNS(NS, 'ellipse')
      tip.setAttribute('cx', tx); tip.setAttribute('cy', ty)
      tip.setAttribute('rx', '1.1'); tip.setAttribute('ry', '2.2')
      tip.setAttribute('transform', `rotate(${a * 180 / Math.PI} ${tx} ${ty})`)
      tip.setAttribute('fill', ripe ? '#D2A94E' : 'none')
      tip.setAttribute('stroke', ripe ? '#8A6116' : '#5B6631')
      tip.setAttribute('stroke-width', '0.7')
      g.appendChild(tip)
      svg.appendChild(g)
    }
    // the binding
    if (n > 0) {
      const tie = document.createElementNS(NS, 'path')
      tie.setAttribute('d', 'M54 30 Q60 27.5 66 30')
      tie.setAttribute('stroke', '#7A3E12'); tie.setAttribute('stroke-width', '1.2'); tie.setAttribute('fill', 'none')
      svg.appendChild(tie)
    }
    return svg
  }

  /** The mockups' rail, kept for pages that port mockup code verbatim. The preview frame draws its own (railFor). */
  function rail(el, o) {
    el.innerHTML = ''
    const back = document.createElement('button')
    back.className = 'back'; back.type = 'button'; back.textContent = '‹ Back'
    if (o.noBack) back.disabled = true
    el.appendChild(back)

    const mid = document.createElement('div'); mid.className = 'mid'
    if (o.numeral) {
      const num = document.createElement('span'); num.className = 'numeral'; num.textContent = o.numeral
      const chap = document.createElement('span'); chap.className = 'chap'; chap.textContent = o.chapter || ''
      mid.appendChild(num); mid.appendChild(chap)
    }
    if (o.dots) {
      const dots = document.createElement('span'); dots.className = 'dots'
      for (let i = 0; i < o.dots; i++) { const d = document.createElement('i'); if (i <= (o.dot || 0)) d.className = 'on'; dots.appendChild(d) }
      mid.appendChild(dots)
    }
    el.appendChild(mid)

    const right = document.createElement('div'); right.className = 'right'
    if (o.minLeft != null) { const t = document.createElement('span'); t.className = 'left-time'; t.textContent = `about ${o.minLeft} min left`; right.appendChild(t) }
    const narrow = window.matchMedia('(max-width: 700px)').matches
    right.appendChild(sheaf(o.done || 0, o.numeral ? 1 : 0, narrow ? { w: 60, h: 18 } : { w: 100, h: 30 }))
    const s = document.createElement('span'); s.className = 'saved'; s.textContent = 'Saved ✓'; right.appendChild(s)
    el.appendChild(right)
  }

  window.CeresFrame = { rail, sheaf }

  /* =========================================================== the preview frame */

  const Nav = window.CeresNav
  const Script = window.CERES_SCRIPT
  if (!Nav || !Script) { console.error('frame.js: load script.js and nav.js first'); return }

  const BANNER = 'Review preview · Next always works · nothing is saved'
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  /** Escape, then keep "$5-20mm", "J.P. Morgan" and "liquid net worth" on one line. */
  const glue = (s) => esc(s)
    .replace(/\$5-20mm/g, '<span class="nw">$5-20mm</span>')
    .replace(/J\.P\. Morgan/g, '<span class="nw">J.P. Morgan</span>')
    .replace(/liquid net worth/g, '<span class="nw">liquid net worth</span>')
  const narrow = () => window.matchMedia('(max-width: 700px)').matches
  const $ = (s, r) => (r || document).querySelector(s)

  /** One engraved ear of wheat (from mockups/index.html), base at (0,0), pointing up. */
  function earG(fill, stroke, sw) {
    const st = `stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"`
    let s = `<path d="M0 0 C0.5 -8 0 -15 0 -22" fill="none" ${st}/>`
    for (let k = 0; k < 5; k++) {
      const y = -11 - k * 3.9
      s += `<ellipse cx="-1.9" cy="${y}" rx="1.45" ry="2.9" transform="rotate(-24 -1.9 ${y})" fill="${fill}" ${st}/>`
      s += `<ellipse cx="1.9" cy="${y + 1.3}" rx="1.45" ry="2.9" transform="rotate(24 1.9 ${y + 1.3})" fill="${fill}" ${st}/>`
      if (k >= 2) {
        s += `<path d="M-2.7 ${y - 2.3} L-5 ${y - 10}" fill="none" ${st}/>`
        s += `<path d="M2.7 ${y - 1} L5 ${y - 8.7}" fill="none" ${st}/>`
      }
    }
    s += `<ellipse cx="0" cy="-30.2" rx="1.25" ry="2.8" fill="${fill}" ${st}/>`
    s += `<path d="M0 -33 L0 -41" fill="none" ${st}/>`
    return s
  }
  function earSVG(w, h, color) {
    return `<svg viewBox="-7 -42 14 43" width="${w}" height="${h}" aria-hidden="true">${earG('none', color || '#7A3E12', 1)}</svg>`
  }


  function bannerHTML(step) {
    const idTxt = step.kind === 'break' ? 'Break ' + step.chapter : step.id
    return `<div class="pv-banner" role="note" aria-label="${esc(BANNER)}">
      <span class="pv-b-t">${esc(BANNER)}</span>
      <span class="pv-b-r"><span class="pv-id">${esc(idTxt)}</span></span>
    </div>`
  }

  function railFor(el, step, o) {
    const c = Nav.chapter(step)
    const d = Nav.dots(step)
    const num = Nav.number(step)
    const prevId = Nav.prev(step.id)
    el.innerHTML = ''
    const back = document.createElement('button')
    back.className = 'back'; back.type = 'button'; back.textContent = '‹ Back'
    back.setAttribute('aria-label', 'Back to the previous step')
    if (!prevId || o.noBack) { back.hidden = true; back.disabled = true }
    el.appendChild(back)

    const mid = document.createElement('div'); mid.className = 'mid'
    if (c && !o.noChapter) {
      mid.innerHTML = `<span class="numeral">${esc(c.numeral)}</span><span class="chap">${esc(c.name)}</span>`
      if (d.total) {
        const dots = document.createElement('span'); dots.className = 'dots'; dots.setAttribute('aria-hidden', 'true')
        for (let i = 0; i < d.total; i++) {
          const x = document.createElement('i'); if (i <= d.on) x.className = 'on'; dots.appendChild(x)
          if (d.sub && i === d.on) { const s = document.createElement('i'); s.className = 'on sub'; dots.appendChild(s) }
        }
        mid.appendChild(dots)
      }
    }
    el.appendChild(mid)

    const right = document.createElement('div'); right.className = 'right'
    if (num) {
      const q = document.createElement('span'); q.className = 'pv-qn'
      q.innerHTML = `<span class="pv-qw">Question </span>${num} of ${Nav.total}`
      right.appendChild(q)
    }
    const sh = sheaf(Nav.done(step), c ? 1 : 0, narrow() ? { w: 60, h: 18 } : { w: 100, h: 30 })
    if (o.hideSheaf) sh.style.visibility = 'hidden'
    right.appendChild(sh)
    const a = document.createElement('a'); a.className = 'pv-contents'; a.href = 'index.html'; a.textContent = 'Contents'
    right.appendChild(a)
    el.appendChild(right)
    return back
  }

  function bandInner(step, b, vars, extraNote) {
    const f = (t) => Nav.fill(t, vars)
    const isQ = step.kind === 'question' || step.kind === 'followup'
    const ctx = isQ && !step.noContext
    let h = ''
    // the bridge is a flex row (the short rule, then the words): the words go in one span, or a no-break piece such as
    // "J.P. Morgan" (2.1) would become a flex item of its own and the rest of the line would wrap beside it
    if (b.bridge) h += `<p class="c-bridge"><span>${glue(f(b.bridge))}</span></p>`
    if (b.question) h += `<h1 class="c-q${b.questionIsObject ? ' sr' : ''}">${glue(f(b.question))}</h1>`
    if (b.instruction) h += `<p class="c-i">${glue(f(b.instruction))}</p>`
    if (ctx) h += `<p class="c-note ctx">${glue(Script.context)}</p>`
    ;(b.notes || []).forEach((n) => { if (n) h += `<p class="c-note">${glue(f(n))}</p>` })
    const pv = [b.previewCondition, b.previewNote, extraNote].filter(Boolean).map((t) => esc(t)).join(' ')  // never filled: it explains the placeholders
    if (pv) h += `<p class="pv-note">${pv}</p>`
    return h
  }

  /**
   * Build the preview frame for a step.
   * opts: stage (bool, default step.stage), band (true | false; default true for question, followup and statement),
   *       objClass (extra class on the object container), vars (extra placeholder values), next (label, or false for
   *       no Next button), later (adds "Continue later" left of Next), noBack, noChapter, hideSheaf.
   */
  function mount(step, opts) {
    const o = Object.assign({}, opts || {})
    if (!step) { document.body.innerHTML = '<p style="padding:40px;font-family:Georgia">Unknown step. <a href="index.html">Contents</a></p>'; return null }
    const stage = o.stage != null ? !!o.stage : !!step.stage
    const bandOn = o.band != null ? !!o.band : (step.kind === 'question' || step.kind === 'followup' || step.kind === 'statement')
    const vars = Object.assign({}, Nav.resolveVars(step), o.vars || {})
    const sampleNote = Nav.resolveVars(step)._sample ? Script.sampleNote : ''
    document.title = `Ceres preview · ${step.id === 'W' ? 'Welcome' : step.kind === 'break' ? 'Chapter ' + step.chapter : step.id}`
    document.body.classList.add('pv', 'pv-' + step.kind, 'pv-t-' + step.template)

    const wrap = document.createElement('div')
    wrap.innerHTML = bannerHTML(step) +
      `<div class="c-page"><div class="c-frame${stage ? ' stage' : ''}" id="frame"><div class="c-rail" id="rail"></div></div></div>`
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild)
    const frame = $('#frame')
    const railEl = $('#rail')
    const backBtn = railFor(railEl, step, o)

    let band = null, side = null, obj
    if (stage) {
      const body = document.createElement('div'); body.className = 'c-body'
      side = document.createElement('div'); side.className = 'c-side'
      const st = document.createElement('div'); st.className = 'c-stage' + (o.objClass ? ' ' + o.objClass : '')
      body.append(side, st)
      frame.appendChild(body)
      if (bandOn) { band = document.createElement('div'); band.className = 'band pv-band'; side.appendChild(band) }
      obj = st
    } else {
      if (bandOn) { band = document.createElement('div'); band.className = 'c-head pv-band'; frame.appendChild(band) }
      obj = document.createElement('div'); obj.className = 'c-obj' + (o.objClass ? ' ' + o.objClass : '')
      frame.appendChild(obj)
    }

    const bandState = {
      bridge: step.bridge, question: step.question, instruction: step.instruction, notes: step.notes || [],
      questionIsObject: !!step.questionIsObject, previewCondition: step.previewCondition, previewNote: step.previewNote,
    }
    let extraNote = sampleNote
    const drawBand = () => { if (band) band.innerHTML = bandInner(step, bandState, ui.vars, extraNote) }

    // the Next bar: [left links] [rule hint] [Next]
    const bar = document.createElement('div'); bar.className = 'c-next-bar pv-bar'
    const left = document.createElement('div'); left.className = 'pv-left'
    const ruleEl = document.createElement('span'); ruleEl.className = 'pv-rule'; ruleEl.setAttribute('aria-live', 'polite')
    bar.append(left, ruleEl)
    let nextBtn = null
    const label = o.next != null ? o.next : step.next
    if (label !== false && label != null) {
      nextBtn = document.createElement('button'); nextBtn.type = 'button'; nextBtn.className = 'c-next'; nextBtn.id = 'next'
      nextBtn.innerHTML = '<span class="pv-lbl"></span><span class="pv-sub"></span>'
      bar.appendChild(nextBtn)
    }
    frame.appendChild(bar)
    const toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite')
    frame.appendChild(toastEl)

    let onNext = null, onBack = null
    const ui = {
      step, frame, rail: railEl, band, side, obj, bar, left, next: nextBtn, back: backBtn, vars,
      esc, glue, earSVG,
      /** Re-draw the question band (internal steps such as 3.1 and 10.5). Pass only what changes. */
      setBand(b) { Object.assign(bandState, b || {}); drawBand() },
      /** complete: hide the hint. Incomplete: "In the survey: <missing>" (falls back to step.rule). Next always works. */
      status(complete, missing) {
        const text = complete ? '' : (missing || Nav.fill(step.rule, ui.vars) || '')
        const line = text ? 'In the survey: ' + text : ''
        ruleEl.textContent = line
        if (nextBtn) $('.pv-sub', nextBtn).textContent = line
        bar.classList.toggle('pv-incomplete', !!line)
        ui.complete = !!complete
      },
      /** Change the Next label (e.g. "Skip" on 10.4 while empty). Pass nothing to restore the step's label. */
      label(text) { if (nextBtn) $('.pv-lbl', nextBtn).textContent = text || label },
      onNext(fn) { onNext = fn },
      onBack(fn) { onBack = fn },
      goNext() { if (onNext && onNext() === true) return; const n = Nav.next(step.id); if (n) Nav.go(n) },
      goBack() { if (onBack && onBack() === true) return; const p = Nav.prev(step.id); if (p) Nav.go(p) },
      /** Adds a grey line to the preview note, e.g. that sample answers stand in. */
      previewNote(text) { extraNote = [sampleNote, text].filter(Boolean).join(' '); drawBand() },
      toast(text, ms) {
        toastEl.textContent = text; toastEl.classList.add('on')
        clearTimeout(toastEl._h); toastEl._h = setTimeout(() => toastEl.classList.remove('on'), ms || 3200)
      },
      save(value) { Nav.answers.set(step.id, value) },
      load() { return Nav.answers.get(step.id) },
      /** Adds "Continue later" on the left of the bar; it shows the survey's toast. */
      addLater(text, toast) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'c-link'; b.textContent = text || Script.ui.later
        b.onclick = () => ui.toast('✓  ' + (toast || Script.ui.laterToast))
        left.appendChild(b); bar.classList.add('link'); return b
      },
      complete: false,
    }
    drawBand()
    ui.label()
    if (step.rule) ui.status(false); else ui.status(true)
    if (o.later) ui.addLater(step.data && step.data.later, step.data && step.data.toast)

    if (nextBtn) nextBtn.addEventListener('click', () => ui.goNext())
    backBtn.addEventListener('click', () => ui.goBack())

    // keyboard: Alt+→ next, Alt+← back (not inside a text field, where Alt+arrow moves by word); Enter on the page = Next
    document.addEventListener('keydown', (e) => {
      const t = e.target
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (e.altKey && !e.ctrlKey && !e.metaKey && !typing) {
        if (e.key === 'ArrowRight') { e.preventDefault(); ui.goNext() }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); ui.goBack() }
        return
      }
      if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.isComposing && nextBtn) {
        const onPage = !t || t === document.body || t === document.documentElement
        if (onPage) { e.preventDefault(); ui.goNext() }
      }
    })
    return ui
  }

  window.CeresPreview = { mount, esc, glue, earSVG, earG, sheaf, BANNER }
})()
