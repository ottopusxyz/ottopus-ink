// The landing page's moving parts: the hero's looping chat, the "how it works" story
// that scroll moves through, and the download cards, which fill themselves in from the
// latest GitHub release.
// Without this file the page still reads: the story shows its conversation as it ended,
// and the download buttons lead to the releases page.
(() => {
  'use strict'

  const REPO = 'ottopusxyz/ottopus-ink'
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // Styles that hide something until a script shows it apply only under this class.
  document.documentElement.classList.add('js')

  /* ---------- smooth scroll ---------- */

  // Lenis, with the Ottopus site's own settings. An anchor stops under the brand bar.
  const BAR = 64
  const lenis = !still && typeof window.Lenis === 'function' ? new window.Lenis({ lerp: 0.12, autoRaf: true, anchors: { offset: -BAR } }) : null

  function scrollPageTo(top) {
    if (lenis) lenis.scrollTo(top, { duration: 1.1 })
    else window.scrollTo({ top, behavior: still ? 'auto' : 'smooth' })
  }

  /* ---------- a chat on a stage ---------- */

  /** "0,2-5,8-" as a test of a step: single steps, spans, and spans open at either end. */
  function steps(text) {
    const spans = text.split(',').map((part) => {
      const [from, to] = part.includes('-') ? part.split('-') : [part, part]
      return [from === '' ? 0 : Number(from), to === '' ? Infinity : Number(to)]
    })
    return (step) => spans.some(([from, to]) => step >= from && step <= to)
  }

  /**
   * A chat window drawn at a step. An element says when it shows with data-at and when
   * it's lit with data-on; a tracker's steps say when they land with data-land.
   */
  function stage(root, landedAt) {
    const shown = [...root.querySelectorAll('[data-at]')].map((el) => ({
      el,
      at: steps(el.dataset.at),
      enters: el.classList.contains('item') || el.hasAttribute('data-pop'),
    }))
    const lit = [...root.querySelectorAll('[data-on]')].map((el) => ({ el, on: steps(el.dataset.on) }))
    const lands = [...root.querySelectorAll('[data-land]')]
    const chat = root.querySelector('.chat')
    root.addEventListener('animationend', (event) => event.target.classList.remove('is-entering'))

    return {
      draw(step, animate) {
        for (const { el, at, enters } of shown) {
          const show = at(step)
          if (show && el.hidden && animate && enters) el.classList.add('is-entering')
          el.hidden = !show
        }
        for (const { el, on } of lit) el.classList.toggle('is-on', on(step))
        const landed = landedAt(step)
        for (const el of lands) {
          const n = Number(el.dataset.land)
          el.classList.toggle('is-done', n <= landed)
          el.classList.toggle('is-through', n < landed)
        }
      },
      /** Fades the chat's messages out, then draws what comes next. */
      clear(then) {
        chat.classList.add('is-clearing')
        window.setTimeout(() => {
          then()
          chat.classList.remove('is-clearing')
        }, 300)
      },
    }
  }

  /** The window's pause button: shows which way it is, and tells the caller on a click. */
  function pauseButton(root, playing, onClick) {
    const button = root.querySelector('[data-toggle]')
    const icons = { pause: button.querySelector('[data-icon="pause"]'), play: button.querySelector('[data-icon="play"]') }
    const draw = () => {
      button.setAttribute('aria-label', playing() ? 'Pause the animation' : 'Play the animation')
      icons.pause.toggleAttribute('hidden', !playing())
      icons.play.toggleAttribute('hidden', playing())
    }
    button.addEventListener('click', () => {
      onClick()
      draw()
    })
    button.hidden = false
    draw()
  }

  /** Tells the caller whenever an element comes on screen or leaves it. */
  function watch(el, onChange) {
    new IntersectionObserver(([entry]) => onChange(entry.isIntersecting), { threshold: 0.3 }).observe(el)
  }

  /* ---------- the hero: two chats in a loop ---------- */

  // A deposit with Claude Code (steps 0 to 5), then an invoice paid from two balances
  // with Codex (6 to 16). Each step holds this long, in milliseconds.
  const HERO_HOLDS = [1500, 1500, 1300, 1100, 2600, 2800, 1500, 1700, 1300, 1000, 1100, 1500, 3600, 1500, 1100, 1100, 3600]
  const HERO_CLEARS = [0, 6] // the steps a new chat starts on
  const heroLanded = (step) => ({ 14: 1, 15: 3, 16: 4 })[step] ?? 0

  function hero(root) {
    const view = stage(root, heroLanded)
    const last = HERO_HOLDS.length - 1
    let step = still ? last : 0
    let timer = 0
    let wanted = !still
    let inView = false

    function wait() {
      window.clearTimeout(timer)
      if (!wanted || !inView || document.hidden) return
      timer = window.setTimeout(() => show(step >= last ? 0 : step + 1), HERO_HOLDS[step])
    }
    function show(next) {
      const paint = () => {
        step = next
        view.draw(step, !still)
        wait()
      }
      if (HERO_CLEARS.includes(next) && !still) view.clear(paint)
      else paint()
    }

    pauseButton(root, () => wanted, () => {
      wanted = !wanted
      wait()
    })
    watch(root, (seen) => {
      inView = seen
      wait()
    })
    document.addEventListener('visibilitychange', wait)
    view.draw(step, false)
  }

  /* ---------- how it works: the story scroll moves through ---------- */

  const STORY_HOLDS = [1900, 1200, 1500, 3200, 1700, 1100, 1900, 2000, 1900, 3600, 1500, 1300, 1100, 1100, 5200]
  // The step each of the five beats starts on.
  const BEAT_STARTS = [0, 2, 4, 8, 10]
  const storyLanded = (step) => (step >= 14 ? 7 : ({ 11: 2, 12: 4, 13: 6 })[step] ?? 0)
  // How long the reader must leave the page alone before it moves on by itself.
  const IDLE_MS = 2500

  function story(root) {
    const view = stage(root, storyLanded)
    const last = STORY_HOLDS.length - 1
    const track = root.querySelector('.story__track')
    const rail = [...root.querySelectorAll('[data-beat]')]
    const copies = [...root.querySelectorAll('[data-copy]')]
    // Room to pin: a wide screen that's tall enough to hold the chat.
    const roomy = window.matchMedia('(min-width: 1000px) and (min-height: 620px)')

    let step = still ? last : 0
    let timer = 0
    let wanted = !still
    let inView = false
    let pinned = false
    let started = false
    let touched = 0
    let queued = false

    const beatOf = (at) => BEAT_STARTS.filter((start) => start <= at).length - 1
    const endOf = (beat) => (beat + 1 < BEAT_STARTS.length ? BEAT_STARTS[beat + 1] - 1 : last)

    function paint(animate) {
      view.draw(step, animate)
      const beat = beatOf(step)
      rail.forEach((button, index) => {
        if (index === beat) button.setAttribute('aria-current', 'step')
        else button.removeAttribute('aria-current')
      })
      copies.forEach((copy, index) => {
        copy.classList.toggle('is-on', index === beat)
        copy.classList.toggle('is-past', index < beat)
      })
    }

    /** Where the pinned track starts and how far it scrolls, in page pixels. */
    function run() {
      const start = track.getBoundingClientRect().top + window.scrollY - BAR
      return { start, length: track.offsetHeight - (window.innerHeight - BAR) }
    }
    /** The beat the page's scroll position is on, and whether the section is holding. */
    function place() {
      const { start, length } = run()
      const progress = (window.scrollY - start) / length
      return { beat: Math.min(BEAT_STARTS.length - 1, Math.max(0, Math.floor(progress * BEAT_STARTS.length))), holding: progress >= 0 && progress <= 1 }
    }
    function scrollToBeat(beat) {
      const { start, length } = run()
      scrollPageTo(start + (length * (beat + 0.5)) / BEAT_STARTS.length)
    }

    function wait() {
      window.clearTimeout(timer)
      if (!wanted || !inView || document.hidden) return
      timer = window.setTimeout(next, STORY_HOLDS[step])
    }
    function next() {
      // Left to itself it plays through and starts again.
      if (!pinned) return show(step >= last ? 0 : step + 1)
      // Pinned, it plays to the end of its beat. Then, if the reader has left the page
      // alone, it moves the page on to the next beat, as scrolling would.
      const beat = beatOf(step)
      if (step < endOf(beat)) return show(step + 1)
      if (beat < BEAT_STARTS.length - 1 && Date.now() - touched > IDLE_MS && place().holding) return scrollToBeat(beat + 1)
      wait()
    }
    function show(at) {
      step = at
      paint(!still)
      wait()
    }
    /** Goes to a beat: from its start when playing, at its end when paused. */
    function enter(beat) {
      show(wanted ? BEAT_STARTS[beat] : endOf(beat))
    }

    function onScroll() {
      queued = false
      if (!pinned || !started) return
      const { beat } = place()
      if (beat !== beatOf(step)) enter(beat)
    }
    window.addEventListener(
      'scroll',
      () => {
        if (queued) return
        queued = true
        window.requestAnimationFrame(onScroll)
      },
      { passive: true },
    )
    for (const type of ['wheel', 'touchmove', 'keydown']) {
      window.addEventListener(type, () => (touched = Date.now()), { passive: true })
    }

    rail.forEach((button, index) => {
      button.addEventListener('click', () => {
        touched = Date.now()
        if (pinned) scrollToBeat(index)
        else enter(index)
      })
    })
    pauseButton(root, () => wanted, () => {
      wanted = !wanted
      wait()
    })

    function setMode() {
      pinned = roomy.matches && !still
      root.classList.toggle('is-pinned', pinned)
      if (started) enter(pinned ? place().beat : beatOf(step))
    }
    roomy.addEventListener('change', setMode)

    watch(root.querySelector('.story__win'), (seen) => {
      inView = seen
      if (seen && !started) {
        started = true
        if (still) return
        enter(pinned ? place().beat : 0)
      } else wait()
    })
    document.addEventListener('visibilitychange', wait)

    root.classList.add('is-live')
    setMode()
    paint(false)
  }

  /* ---------- the agents: a few at a time ---------- */

  // How long before the next slot changes, in milliseconds.
  const AGENT_TICK_MS = 700

  /**
   * Shows the list of agents a few at a time. The slots take turns swapping theirs for
   * the one that has waited longest, so the set on show keeps changing. The plain list
   * stays for a screen reader, which has no use for the turns.
   */
  function agents(list) {
    if (still) return
    const count = window.innerWidth < 600 ? 2 : 3
    const chips = [...list.children].map((chip) => {
      const copy = document.createElement('span')
      copy.className = 'agent'
      copy.append(...[...chip.childNodes].map((node) => node.cloneNode(true)))
      return copy
    })
    if (chips.length <= count) return
    const live = document.createElement('div')
    live.className = 'agents__live'
    live.setAttribute('aria-hidden', 'true')
    // The first few start on show, one a slot. The rest wait their turn in line.
    const slots = chips.slice(0, count).map((chip) => {
      const el = document.createElement('div')
      el.className = 'slot'
      chip.classList.add('is-on')
      el.append(chip)
      live.append(el)
      return { el, shown: chip }
    })
    const waiting = chips.slice(count)
    list.classList.add('sr-only')
    list.after(live)

    let turn = 0
    let timer = 0
    function swap() {
      const slot = slots[turn % count]
      turn += 1
      const leaving = slot.shown
      const coming = waiting.shift()
      waiting.push(leaving)
      coming.classList.remove('is-on', 'is-out')
      slot.el.append(coming)
      void coming.offsetWidth // so it starts from below, not where it last was
      coming.classList.add('is-on')
      leaving.classList.remove('is-on')
      leaving.classList.add('is-out')
      window.setTimeout(() => {
        if (leaving.classList.contains('is-on')) return
        leaving.remove()
        leaving.classList.remove('is-out')
      }, 520)
      slot.shown = coming
    }
    watch(live, (seen) => {
      window.clearInterval(timer)
      if (seen) timer = window.setInterval(() => document.hidden || swap(), AGENT_TICK_MS)
    })
  }

  /* ---------- sections that pop in ---------- */

  /** Marks a section once it comes on screen, which lets its pieces pop in. */
  function reveals() {
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          seen.unobserve(entry.target)
        }
      },
      { threshold: 0.18 },
    )
    for (const section of document.querySelectorAll('[data-reveal]')) seen.observe(section)
  }

  /* ---------- the downloads ---------- */

  // Each card's files, best first. The first one the release has is the button; the next
  // one with an `alt` line is offered under it. A browser can't tell an Apple Silicon Mac
  // from an Intel one, so the Mac card offers both: most Macs sold since 2021 are Apple
  // Silicon, and the Intel build won't run as well there, nor the Apple Silicon one at all
  // on an Intel Mac.
  const BUILDS = {
    mac: {
      name: 'macOS',
      choices: [
        { file: /arm64\.dmg$/i, label: 'Download for Apple Silicon', alt: 'Apple Silicon Mac? Download that build' },
        { file: /x64\.dmg$/i, label: 'Download for Intel Macs', alt: 'Intel Mac? Download the Intel build' },
        { file: /\.dmg$/i, label: 'Download for macOS' },
        { file: /(mac|darwin).*\.zip$/i, label: 'Download for macOS' },
      ],
    },
    linux: {
      name: 'Linux',
      choices: [
        { file: /\.AppImage$/i, label: 'Download for Linux', alt: 'Any 64-bit Linux? Download the AppImage' },
        { file: /\.deb$/i, label: 'Download the .deb', alt: 'Ubuntu or Debian? Download the .deb' },
      ],
    },
  }

  function megabytes(bytes) {
    return `${Math.round(bytes / 1e6)} MB`
  }

  /** Which of the two this visitor is on, if either. */
  function visitorOs() {
    const ua = navigator.userAgent
    if (/Android|iPhone|iPad/i.test(ua)) return null
    if (/Mac/i.test(ua)) return 'mac'
    if (/Linux|X11/i.test(ua)) return 'linux'
    return null
  }

  async function downloads() {
    const cards = Object.fromEntries(Object.keys(BUILDS).map((os) => [os, document.querySelector(`[data-dl="${os}"]`)]))
    const mine = visitorOs()
    // The hero's one button names the visitor's system when Ink runs on it, and is a
    // plain "Download" otherwise. Either way it leads to the cards, which hold the files.
    const heroLabel = document.querySelector('[data-get-label]')
    if (heroLabel && mine) heroLabel.textContent = `Download for ${BUILDS[mine].name}`
    if (mine && cards[mine]) cards[mine].classList.add('is-yours')

    // The newest release, or null when none is published. Asking for the list (rather
    // than /latest) answers an empty repository with an empty list instead of an error.
    let release
    try {
      const answer = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=5`, { headers: { Accept: 'application/vnd.github+json' } })
      if (!answer.ok) return
      const list = await answer.json()
      release = (Array.isArray(list) ? list : []).find((each) => !each.draft && !each.prerelease) ?? null
    } catch {
      return // GitHub can't be reached: the buttons keep leading to the releases page.
    }

    for (const [os, build] of Object.entries(BUILDS)) {
      const card = cards[os]
      if (!card) continue
      const note = card.querySelector('[data-dl-note]')
      const link = card.querySelector('[data-dl-link]')
      const meta = card.querySelector('[data-dl-meta]')
      const text = card.querySelector('[data-dl-label]')
      const alt = card.querySelector('[data-dl-alt]')
      const assets = release && Array.isArray(release.assets) ? release.assets : []
      // Only a file from this repository's own releases becomes a link.
      const ours = (each) => String(each.browser_download_url).startsWith(`https://github.com/${REPO}/releases/download/`)
      const found = []
      for (const choice of build.choices) {
        const asset = assets.find((each) => choice.file.test(String(each.name)) && ours(each))
        if (asset && !found.some((seen) => seen.asset === asset)) found.push({ choice, asset })
      }
      const [main] = found
      const second = found.slice(1).find((each) => each.choice.alt)
      if (main) {
        link.href = main.asset.browser_download_url
        text.textContent = main.choice.label
        note.textContent = `The latest packaged build for ${build.name}.`
        meta.textContent = `${release.tag_name} · ${main.asset.name} · ${megabytes(main.asset.size)}`
        if (second && alt) {
          alt.href = second.asset.browser_download_url
          alt.textContent = second.choice.alt
          alt.hidden = false
        }
      } else {
        note.textContent = `A packaged build for ${build.name} is on the way. Until then, build from source.`
        text.textContent = 'See releases on GitHub'
        meta.textContent = release ? `${release.tag_name} has no ${build.name} file yet` : 'No release published yet'
      }
    }
  }

  const heroStage = document.querySelector('[data-hero]')
  if (heroStage) hero(heroStage)
  const storyStage = document.querySelector('[data-story]')
  if (storyStage) story(storyStage)
  const agentList = document.querySelector('[data-agents]')
  if (agentList) agents(agentList)
  reveals()
  downloads()
})()
