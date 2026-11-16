// The landing page's two moving parts: the replay of the demo conversation, and the
// download cards, which fill themselves in from the latest GitHub release.
// Without this file the page still reads: the conversation shows as it ended, and the
// download buttons lead to the releases page.
(() => {
  'use strict'

  const REPO = 'ottopusxyz/ottopus-ink'

  /* ---------- the replay ---------- */

  // The conversation in steps. Each element says when it shows with data-from,
  // data-until and data-except; these are how long each step holds, in milliseconds.
  const HOLDS = [1900, 1200, 1500, 3200, 1700, 1100, 1900, 2000, 1900, 3600, 1500, 1300, 1100, 1100, 5200]
  const LAST = HOLDS.length - 1
  // How many of the tracker's steps have landed at each step of the replay.
  const LANDED = { 11: 2, 12: 4, 13: 6, 14: 7 }

  const listOf = (text) => (text ? text.split(',').map(Number) : [])

  /** Whether an element shows at a step. */
  function showsAt(el, step) {
    const from = el.dataset.from === undefined ? 0 : Number(el.dataset.from)
    const until = el.dataset.until === undefined ? LAST : Number(el.dataset.until)
    return step >= from && step <= until && !listOf(el.dataset.except).includes(step)
  }

  function replay(root) {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timed = [...root.querySelectorAll('[data-from], [data-until], [data-except]')]
    const beats = [...root.querySelectorAll('[data-beat]')]
    const lands = [...root.querySelectorAll('[data-land]')]
    const controls = root.querySelector('[data-controls]')
    const toggle = root.querySelector('[data-toggle]')
    const label = root.querySelector('[data-toggle-label]')
    const icons = { pause: root.querySelector('[data-icon="pause"]'), play: root.querySelector('[data-icon="play"]') }

    let step = LAST
    let timer = 0
    let wanted = !still // whether the visitor wants it playing
    let inView = false
    let started = false

    function draw(animate) {
      for (const el of timed) {
        const show = showsAt(el, step)
        const enters = el.classList.contains('item') || el.hasAttribute('data-pop')
        if (show && el.hidden && animate && enters) {
          el.classList.add('is-entering')
          el.addEventListener('animationend', (event) => event.target === el && el.classList.remove('is-entering'))
        }
        el.hidden = !show
      }
      const landed = LANDED[step] ?? 0
      for (const el of lands) {
        const n = Number(el.dataset.land)
        el.classList.toggle('is-done', n <= landed)
        el.classList.toggle('is-through', n < landed)
      }
      const now = beats.filter((beat) => Number(beat.dataset.start) <= step).length - 1
      beats.forEach((beat, index) => {
        beat.classList.toggle('is-done', index < now)
        if (index === now) beat.setAttribute('aria-current', 'step')
        else beat.removeAttribute('aria-current')
      })
      const playing = wanted
      label.textContent = playing ? 'Pause' : 'Play'
      icons.pause.toggleAttribute('hidden', !playing)
      icons.play.toggleAttribute('hidden', playing)
    }

    function wait() {
      window.clearTimeout(timer)
      if (!wanted || !inView || document.hidden) return
      timer = window.setTimeout(() => show(step >= LAST ? 0 : step + 1), HOLDS[step])
    }

    function show(next) {
      step = next
      draw(!still)
      wait()
    }

    toggle.addEventListener('click', () => {
      wanted = !wanted
      if (wanted && step >= LAST) show(0)
      else {
        draw(false)
        wait()
      }
    })
    root.querySelector('[data-restart]').addEventListener('click', () => {
      wanted = true
      show(0)
    })
    for (const beat of beats) {
      beat.addEventListener('click', () => {
        wanted = !still
        show(Number(beat.dataset.start))
      })
    }

    // It plays only while it's on screen, and starts from the top the first time.
    new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting
        if (inView && wanted && !started) {
          started = true
          show(0)
        } else wait()
      },
      { threshold: 0.35 },
    ).observe(root)
    document.addEventListener('visibilitychange', wait)

    controls.hidden = false
    draw(false)
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

  const stage = document.querySelector('[data-replay]')
  if (stage) replay(stage)
  downloads()
})()
