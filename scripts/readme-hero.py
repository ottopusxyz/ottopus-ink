"""Writes .github/assets/hero.svg, the README's animated hero.

GitHub shows a README image without scripts or outside files, so everything the
picture needs is inside it: the fonts as data URLs, the logos as nested SVGs, and
the motion as CSS animations. It follows the landing page's hero (site/index.html):
the same sea, creatures, colours and chat window, playing one invoice paid from
two balances on a loop. With reduced motion on, it shows that chat as it ended.

Run it from the repository root: python3 scripts/readme-hero.py
"""

import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / 'site/assets/fonts'
LOGOS = ROOT / 'site/assets/logos'
OUT = ROOT / '.github/assets/hero.svg'

W, H = 1280, 640
LOOP = 16  # seconds for one pass of the chat

NAVY, CORAL, CORAL_TEXT, CORAL_SOFT, CORAL_SHADE, CREAM = '#16213E', '#F58A6A', '#B3421F', '#FFE6DC', '#E06A47', '#FFF0DC'
SURFACE, BORDER, BORDER_STRONG, TEXT_2, TEXT_3 = '#FFFCF7', '#E3DBCF', '#C4B9A8', '#4B556E', '#66708A'
PLAN_BG, PLAN_TEXT, OK, OK_BG, OK_TEXT, WATER_2 = '#E8F0FF', '#1D4FB0', '#1FB57A', '#E1F6EC', '#0E6642', '#E9EFF7'


def font_face(family: str, weight: int, file: str) -> str:
    data = base64.b64encode((FONTS / file).read_bytes()).decode()
    return f"@font-face{{font-family:'{family}';font-weight:{weight};src:url(data:font/woff2;base64,{data}) format('woff2');}}"


def logo(name: str, x: float, y: float, size: float) -> str:
    """A logo from the site as a nested SVG, without its title."""
    svg = (LOGOS / f'{name}.svg').read_text()
    svg = re.sub(r'<title>.*?</title>', '', svg)
    svg = re.sub(r'\s(width|height)="[^"]*"', '', svg, count=2)
    svg = svg.replace('<svg ', f'<svg x="{x}" y="{y}" width="{size}" height="{size}" ', 1)
    return re.sub(r'>\s+<', '><', svg.strip())


def mark(name: str, x: float, y: float, size: float, radius: float) -> str:
    """An agent's logo in the app's cream tile."""
    return (
        f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="{radius}" fill="{CREAM}" stroke="{BORDER}"/>'
        + logo(name, x, y, size)
    )


# Each step of the chat is a group that appears at `start` and stays until the loop ends.
# Keyframes are written per group, since one CSS animation can't hold a different delay on each loop.
keyframes: list[str] = []


def shown(name: str, start: float, end: float = 93.0, rise: float = 8) -> str:
    """A class that fades its group in at start% of the loop and out at end%."""
    a = max(start - 1.6, 0)
    keyframes.append(
        f'@keyframes {name}{{0%,{a:.1f}%{{opacity:0;transform:translateY({rise}px)}}'
        f'{start:.1f}%,{end:.1f}%{{opacity:1;transform:none}}'
        f'{min(end + 1.6, 100):.1f}%,100%{{opacity:0;transform:none}}}}'
    )
    return f'.{name}{{animation:{name} {LOOP}s cubic-bezier(.2,.8,.2,1) infinite}}'


def only(name: str, start: float, end: float) -> str:
    """A class shown only between start% and end%, without moving."""
    a, b = max(start - 1.2, 0), min(end + 1.2, 100)
    keyframes.append(
        f'@keyframes {name}{{0%,{a:.1f}%{{opacity:0}}{start:.1f}%,{end:.1f}%{{opacity:1}}{b:.1f}%,100%{{opacity:0}}}}'
    )
    return f'.{name}{{animation:{name} {LOOP}s ease infinite}}'


css_steps = [
    only('empty', 0, 7.5),
    shown('ask', 9),
    shown('t1', 17),
    shown('t2', 25),
    shown('t3', 33),
    shown('ticket', 42, rise=14),
    only('st1', 42, 60),
    only('st2', 61.5, 73),
    only('st3', 74.5, 93),
]

# ---------------------------------------------------------------- the water

water = f'''
<rect width="{W}" height="{H}" rx="28" fill="url(#sea)"/>
<g clip-path="url(#frame)">
  <ellipse class="wash" cx="250" cy="0" rx="760" ry="300" fill="url(#caustic)"/>
  <ellipse class="wash-b" cx="1000" cy="20" rx="560" ry="260" fill="url(#caustic)"/>
  <g class="shaft" style="--tilt:14deg"><rect x="640" y="-80" width="150" height="820" fill="url(#light)"/></g>
  <g class="shaft s2" style="--tilt:10deg"><rect x="860" y="-80" width="90" height="820" fill="url(#light)"/></g>
  <g class="shaft s3" style="--tilt:17deg"><rect x="1060" y="-80" width="180" height="820" fill="url(#light)"/></g>
  <g fill="none" stroke="rgba(46,124,246,.28)" stroke-width="2">
    <circle class="rise" cx="586" cy="560" r="6"/>
    <circle class="rise r2" cx="606" cy="560" r="3.5"/>
    <circle class="rise r3" cx="566" cy="560" r="4.5"/>
    <circle class="rise r4" cx="626" cy="560" r="7"/>
  </g>
  <g style="color:rgba(46,124,246,.34)">
    <g transform="translate(470 84)"><g class="swim" style="--travel:-180px;--lift:-12px;animation-duration:60s"><use href="#fish" width="30" height="18"/></g></g>
    <g transform="translate(640 520)"><g class="swim" style="--travel:-110px;--lift:10px;animation-duration:70s;animation-delay:-22s"><use href="#fish" width="44" height="27"/></g></g>
    <g transform="translate(1236 300)"><g class="float" style="--travel:10px;--lift:-140px;animation-duration:54s;animation-delay:-6s"><use href="#jelly" width="34" height="45"/></g></g>
    <g transform="translate(22 250)"><g class="float" style="--travel:-8px;--lift:-100px;animation-duration:62s;animation-delay:-28s"><use href="#jelly" width="22" height="29"/></g></g>
    <g transform="translate(260 600)"><g class="swim" style="--travel:280px;--lift:-18px;animation-duration:88s;animation-delay:-12s"><use href="#turtle" width="50" height="29"/></g></g>
  </g>
  <svg x="0" y="{H - 120}" width="{W}" height="120" viewBox="0 0 1440 170" preserveAspectRatio="none">
    <path d="M0 90 C 180 60 320 120 520 96 S 900 50 1100 88 S 1340 120 1440 80 L1440 170 L0 170 Z" fill="#8DB4F3"/>
    <path d="M0 130 C 240 110 420 150 700 128 S 1160 110 1440 136 L1440 170 L0 170 Z" fill="#7BA6EF" opacity=".6"/>
  </svg>
  <g fill="none" stroke="#6F9DEC" stroke-width="6" stroke-linecap="round">
    <g class="weed" style="transform-origin:116px 640px"><path d="M116 636 C 107 610 130 592 117 565 M134 640 C 144 615 125 601 139 580"/></g>
    <g class="weed w2" style="transform-origin:1052px 640px"><path d="M1049 626 C 1040 601 1063 583 1050 553 M1067 630 C 1078 607 1058 593 1072 570 M1087 632 C 1080 616 1096 605 1089 587"/></g>
  </g>
</g>
'''

# ---------------------------------------------------------------- the words

LX = 64
words = f'''
<g font-family="Figtree, system-ui, sans-serif" fill="{NAVY}">
  <rect x="{LX}" y="122" width="262" height="36" rx="18" fill="#fff" fill-opacity=".7" stroke="{NAVY}" stroke-opacity=".08"/>
  {logo('chain-near', LX + 12, 129, 22)}
  <text x="{LX + 42}" y="145.5" font-size="15" font-weight="600">Built at the NEAR hackathon</text>

  <text font-family="Quicksand, ui-rounded, sans-serif" font-weight="700" font-size="56" letter-spacing="-1">
    <tspan x="{LX - 2}" y="236">Every crypto move,</tspan>
    <tspan x="{LX - 2}" y="298" fill="{CORAL_TEXT}">one ask away.</tspan>
  </text>

  <text font-size="19.5" fill="{TEXT_2}">
    <tspan x="{LX}" y="350">Ask the agent on your own computer to pay, swap</tspan>
    <tspan x="{LX}" y="378">or send. NEAR Intents finds the route across chains,</tspan>
    <tspan x="{LX}" y="406">and nothing moves until you sign.</tspan>
  </text>

  <g class="btn">
    <rect x="{LX + 3}" y="443" width="248" height="52" rx="26" fill="{NAVY}"/>
    <rect x="{LX}" y="440" width="248" height="52" rx="26" fill="{CORAL}" stroke="{NAVY}" stroke-width="2"/>
    <path d="M{LX + 30} 457v12M{LX + 24.5} 464.5 {LX + 30} 470l5.5-5.5M{LX + 23} 476h14" fill="none" stroke="{NAVY}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="{LX + 48}" y="472" font-size="16.5" font-weight="700">Download for Mac · Linux</text>
  </g>
  <circle cx="{LX + 284}" cy="466" r="11" fill="none" stroke="{NAVY}" stroke-width="2"/>
  <path d="M{LX + 280.5} 460.5v11l8.5-5.5Z" fill="{NAVY}"/>
  <text x="{LX + 304}" y="472" font-size="16.5" font-weight="700">Watch the demo</text>

  <text x="{LX}" y="540" font-size="12.5" font-weight="700" letter-spacing="1.3" fill="{TEXT_3}">RUNS ON THE AGENT YOU ALREADY USE</text>
  {mark('agent-claude', LX, 556, 32, 10)}<text x="{LX + 42}" y="577" font-size="16" font-weight="600">Claude Code</text>
  <g opacity=".55">
    {mark('agent-codex', LX + 160, 556, 32, 10)}<text x="{LX + 202}" y="577" font-size="16" font-weight="600">Codex</text>
    {mark('agent-grok', LX + 268, 556, 32, 10)}<text x="{LX + 310}" y="577" font-size="16" font-weight="600">Grok</text>
  </g>
  <rect x="{LX + 358}" y="561" width="48" height="22" rx="11" fill="{PLAN_BG}"/>
  <text x="{LX + 382}" y="576.5" font-size="11.5" font-weight="700" fill="{PLAN_TEXT}" text-anchor="middle">NEXT</text>
</g>
'''

# ---------------------------------------------------------------- the chat window

WX, WY, WW, WH = 688, 122, 528, 498
TX = 62  # where the agent's column starts inside the window


def tool(y: float, title: str, detail: str, extra: str = '') -> str:
    """One finished tool call on the rail, as in the app."""
    return f'''
    <rect x="{TX}" y="{y}" width="{WW - TX - 20}" height="32" rx="11" fill="#fff" fill-opacity=".9" stroke="{NAVY}" stroke-opacity=".06"/>
    <line x1="{TX - 10}" y1="{y + 2}" x2="{TX - 10}" y2="{y + 30}" stroke="{CORAL_SHADE}" stroke-width="3" stroke-linecap="round" stroke-dasharray="7 4" opacity=".9"/>
    <circle cx="{TX - 10}" cy="{y + 16}" r="5" fill="{CREAM}" stroke="{CORAL}" stroke-width="2.5"/>
    {extra}
    <text x="{TX + 14}" y="{y + 21}" font-size="14" font-weight="700">{title}</text>
    <text x="{WW - 34}" y="{y + 21}" font-size="12.5" font-family="'JetBrains Mono', ui-monospace, monospace" fill="{TEXT_3}" text-anchor="end">{detail}</text>'''


def check(x: float, y: float) -> str:
    return f'<circle cx="{x}" cy="{y}" r="9" fill="{OK_BG}"/><path d="m{x - 4} {y}2.6 2.6 5-5.2" fill="none" stroke="{OK_TEXT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'


ticket_y = 254
chat = f'''
<g transform="translate({WX} {WY})" font-family="Figtree, system-ui, sans-serif" fill="{NAVY}">
  <rect x="0" y="6" width="{WW}" height="{WH}" rx="22" fill="{NAVY}" opacity=".08"/>
  <rect x="0" y="0" width="{WW}" height="{WH}" rx="22" fill="{SURFACE}" stroke="{NAVY}" stroke-opacity=".08"/>
  <path d="M0 22a22 22 0 0 1 22-22h{WW - 44}a22 22 0 0 1 22 22v26H0Z" fill="#fff" fill-opacity=".5"/>
  <line x1="0" y1="48" x2="{WW}" y2="48" stroke="{BORDER}"/>
  <text x="18" y="30" font-size="14.5" font-weight="700"><tspan class="empty">New chat</tspan></text>
  <text x="18" y="30" font-size="14.5" font-weight="700" class="ask">pay this invoice</text>
  <rect x="{WW - 168}" y="11" width="150" height="26" rx="13" fill="{OK_BG}"/>
  <circle cx="{WW - 154}" cy="24" r="3.5" fill="{OK}"/>
  <text x="{WW - 144}" y="28.5" font-size="12" font-weight="600" fill="{OK_TEXT}">Ottopus tools only</text>

  <g class="empty">
    <use href="#otto" x="{WW / 2 - 32}" y="150" width="64" height="64"/>
    <text x="{WW / 2}" y="246" font-size="17" font-weight="700" text-anchor="middle">Ask for it. Sign it yourself.</text>
  </g>

  <g class="ask">
    <rect x="{WW - 258}" y="60" width="240" height="66" rx="16" fill="{CORAL_SOFT}"/>
    <rect x="{WW - 30}" y="114" width="12" height="12" fill="{CORAL_SOFT}"/>
    <text x="{WW - 242}" y="84" font-size="15">pay this invoice</text>
    <rect x="{WW - 242}" y="93" width="150" height="24" rx="8" fill="#fff" stroke="{BORDER}"/>
    <path d="M{WW - 233} 98.5h6l3.5 3.5v10h-9.5Z M{WW - 227} 98.5v3.5h3.5" fill="none" stroke="{CORAL_TEXT}" stroke-width="1.5" stroke-linejoin="round"/>
    <text x="{WW - 216}" y="110" font-size="12.5" font-weight="600">invoice-0142.pdf</text>
  </g>

  <g class="t1">{mark('agent-claude', 18, 140, 28, 9)}</g>
  <g class="t1">{tool(138, 'Read the invoice', '250 USDC · Base')}</g>
  <g class="t2">{tool(174, 'Checked what you hold', 'get_portfolio')}</g>
  <g class="t3">{tool(210, 'Planned the payment', 'create_plan')}</g>

  <g class="ticket">
    <rect x="{TX + 3}" y="{ticket_y + 3}" width="{WW - TX - 20}" height="146" rx="18" fill="{NAVY}"/>
    <rect x="{TX}" y="{ticket_y}" width="{WW - TX - 20}" height="146" rx="18" fill="#fff" stroke="{NAVY}" stroke-width="2"/>
    <text x="{TX + 16}" y="{ticket_y + 32}" font-family="Quicksand, ui-rounded, sans-serif" font-size="21" font-weight="700" letter-spacing="-.4">Pay 250 USDC on Base</text>
    <text x="{TX + 16}" y="{ticket_y + 52}" font-size="12.5" fill="{TEXT_3}">to Tidepool Design Studio · invoice 0142</text>
    <rect x="{WW - 96}" y="{ticket_y + 14}" width="58" height="22" rx="11" fill="{PLAN_BG}"/>
    <text x="{WW - 67}" y="{ticket_y + 29.5}" font-size="11.5" font-weight="700" fill="{PLAN_TEXT}" text-anchor="middle">PLAN</text>

    <g font-size="12.5" font-weight="600">
      <rect x="{TX + 16}" y="{ticket_y + 64}" width="168" height="24" rx="12" fill="{WATER_2}"/>
      {logo('token-usdc', TX + 19, ticket_y + 66, 20)}
      <text x="{TX + 44}" y="{ticket_y + 80.5}">180 · NEAR Intents</text>
      <rect x="{TX + 16}" y="{ticket_y + 92}" width="168" height="24" rx="12" fill="{WATER_2}"/>
      {logo('chain-solana', TX + 19, ticket_y + 94, 20)}
      <text x="{TX + 44}" y="{ticket_y + 108.5}">70 · Solana</text>
      <path class="flow" d="M{TX + 194} {ticket_y + 90} C {TX + 214} {ticket_y + 90} {TX + 214} {ticket_y + 90} {TX + 252} {ticket_y + 90}" fill="none" stroke="{CORAL}" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 7"/>
      <path d="m{TX + 248} {ticket_y + 84} 6 6-6 6" fill="none" stroke="{NAVY}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="{TX + 266}" y="{ticket_y + 77}" width="160" height="26" rx="13" fill="{OK_BG}"/>
      {logo('chain-base', TX + 270, ticket_y + 80, 20)}
      <text x="{TX + 295}" y="{ticket_y + 94.5}" fill="{OK_TEXT}">250 USDC · Base</text>
    </g>

    <line x1="{TX + 16}" y1="{ticket_y + 118}" x2="{WW - 36}" y2="{ticket_y + 118}" stroke="{BORDER_STRONG}" stroke-width="1.5" stroke-dasharray="5 5" opacity=".7"/>
    <g font-size="12.5" font-weight="700">
      <g class="st1"><circle cx="{TX + 22}" cy="{ticket_y + 132}" r="4" fill="{PLAN_TEXT}"/><text x="{TX + 32}" y="{ticket_y + 136.5}" fill="{PLAN_TEXT}">Waiting for you in the review window</text></g>
      <g class="st2"><circle cx="{TX + 22}" cy="{ticket_y + 132}" r="4" fill="{CORAL_SHADE}"/><text x="{TX + 32}" y="{ticket_y + 136.5}" fill="{CORAL_TEXT}">Approved · two parts on their way</text></g>
      <g class="st3">{check(TX + 24, ticket_y + 132)}<text x="{TX + 40}" y="{ticket_y + 136.5}" fill="{OK_TEXT}">Paid · landed on Base</text></g>
    </g>
  </g>

  <g transform="translate(0 {WH - 80})">
    <rect x="14" y="0" width="{WW - 28}" height="66" rx="18" fill="#fff" stroke="{BORDER}"/>
    <text x="32" y="26" font-size="14" fill="{TEXT_3}">Reply to your agent</text>
    <circle cx="40" cy="48" r="11" fill="none" stroke="{BORDER}"/>
    <path d="M40 43.5v9M35.5 48h9" stroke="{TEXT_2}" stroke-width="1.6" stroke-linecap="round"/>
    <rect x="58" y="37" width="118" height="22" rx="11" fill="{CORAL_SOFT}"/>
    {logo('agent-claude', 61, 38, 20)}
    <text x="84" y="52.5" font-size="12.5" font-weight="600" fill="{CORAL_TEXT}">Claude Code</text>
    <circle cx="{WW - 44}" cy="46" r="14" fill="{CREAM}" stroke="{BORDER}"/>
    <path d="M{WW - 44} 53V40M{WW - 49} 45l5-5 5 5" fill="none" stroke="{NAVY}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</g>
<g transform="translate({WX + WW - 176} {WY - 112})"><g class="bob"><use href="#otto" width="128" height="128"/></g></g>
'''

otto = re.search(r'<symbol id="otto-mini".*?</symbol>', (ROOT / 'site/index.html').read_text(), re.S).group(0)
otto = otto.replace('id="otto-mini"', 'id="otto"')
creatures = '\n'.join(
    re.search(rf'<symbol id="s-{name}".*?</symbol>', (ROOT / 'site/index.html').read_text(), re.S).group(0).replace(f'id="s-{name}"', f'id="{name}"')
    for name in ('fish', 'jelly', 'turtle')
)

motion = '''
.wash{animation:wash 14s ease-in-out infinite}
.wash-b{animation:wash-b 19s ease-in-out infinite}
@keyframes wash{0%,100%{opacity:.7;transform:translate(0,0)}50%{opacity:1;transform:translate(24px,8px)}}
@keyframes wash-b{0%,100%{opacity:.55;transform:translate(0,0)}50%{opacity:.95;transform:translate(-36px,14px)}}
.shaft{transform-box:fill-box;transform-origin:top center;transform:rotate(var(--tilt));animation:sway 22s ease-in-out infinite}
.s2{animation-delay:-7s}.s3{animation-delay:-13s}
@keyframes sway{0%,100%{opacity:.8;transform:rotate(var(--tilt)) scaleY(1)}50%{opacity:1;transform:rotate(calc(var(--tilt) + 1.5deg)) scaleY(1.04)}}
.rise{transform-box:fill-box;transform-origin:center;animation:rise 9s ease-in infinite;opacity:0}
.r2{animation-delay:2.4s}.r3{animation-delay:5.1s}.r4{animation-delay:7.3s}
@keyframes rise{0%{transform:translateY(0) scale(.7);opacity:0}14%{opacity:1}100%{transform:translateY(-420px) scale(1.1);opacity:0}}
.swim{animation:swim 60s linear infinite both}
.float{animation:float 54s ease-in-out infinite both}
@keyframes swim{0%{transform:translate(0,0);opacity:0}12%{opacity:1}50%{transform:translate(calc(var(--travel) * .5),var(--lift))}88%{opacity:1}100%{transform:translate(var(--travel),0);opacity:0}}
@keyframes float{0%{transform:translate(0,0);opacity:0}16%{opacity:1}50%{transform:translate(var(--travel),calc(var(--lift) * .55))}84%{opacity:1}100%{transform:translate(0,var(--lift));opacity:0}}
.weed{animation:weed 6s ease-in-out infinite}.w2{animation-delay:-2.5s}
@keyframes weed{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
.bob{animation:bob 4.2s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-7px) rotate(2deg)}}
.flow{animation:flow 1.2s linear infinite}
@keyframes flow{to{stroke-dashoffset:-18}}
'''

# Without motion, the picture is the chat as it ended: no empty state, the last status.
still = '''
@media (prefers-reduced-motion: reduce){
  *{animation:none!important}
  .empty,.st1,.st2{opacity:0}
  .rise{opacity:0}
}
'''

fonts = ''.join([
    font_face('Quicksand', 700, 'quicksand-latin-700-normal.woff2'),
    font_face('Figtree', 400, 'figtree-latin-400-normal.woff2'),
    font_face('Figtree', 600, 'figtree-latin-600-normal.woff2'),
    font_face('Figtree', 700, 'figtree-latin-700-normal.woff2'),
    font_face('JetBrains Mono', 500, 'jetbrains-mono-latin-500-normal.woff2'),
])

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-labelledby="title desc">
<title id="title">Ottopus Ink: every crypto move, one ask away</title>
<desc id="desc">Ottopus Ink's hero, under water. Ask the agent on your own computer to pay, swap or send; NEAR Intents finds the route across chains, and nothing moves until you sign. A chat with Claude Code pays an invoice of 250 USDC on Base from two balances, 180 from NEAR Intents and 70 from Solana, after it is approved in the review window.</desc>
<style>{fonts}{motion}{''.join(css_steps)}{''.join(keyframes)}{still}</style>
<defs>
  <clipPath id="frame"><rect width="{W}" height="{H}" rx="28"/></clipPath>
  <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#F4F7FB"/><stop offset=".3" stop-color="#E4EDFB"/><stop offset=".7" stop-color="#C7DAF7"/><stop offset="1" stop-color="#A9C7F3"/>
  </linearGradient>
  <radialGradient id="caustic"><stop offset="0" stop-color="#2E7CF6" stop-opacity=".07"/><stop offset="1" stop-color="#2E7CF6" stop-opacity="0"/></radialGradient>
  <linearGradient id="light" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".72" stop-color="#fff" stop-opacity="0"/></linearGradient>
  {otto}
  {creatures}
</defs>
{water}
{words}
{chat}
</svg>
'''

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(svg)
print(f'{OUT.relative_to(ROOT)}: {len(svg.encode()) / 1024:.0f} KB')
