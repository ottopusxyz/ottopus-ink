import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MAX_MARKDOWN_CHARS, MAX_REFERENCED_CHARS, MAX_TABLE_CELLS, Markdown } from './markdown'

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }))
/** What's inside the wrapper. */
const body = (text: string) => html(text).replace(/^<div class="ink-md">/, '').replace(/<\/div>$/, '')

describe('Markdown: the safe list', () => {
  it('formats bold, italics and inline code', () => {
    expect(body('**a** *b* `c`')).toBe('<p><strong>a</strong> <em>b</em> <code>c</code></p>')
  })

  it('keeps headings modest', () => {
    expect(body('# a')).toBe('<h3>a</h3>')
    expect(body('## a')).toBe('<h3>a</h3>')
    expect(body('### a')).toBe('<h4>a</h4>')
    expect(body('###### a')).toBe('<h4>a</h4>')
  })

  it('formats lists, keeping where a numbered one starts', () => {
    expect(body('- a\n- b')).toBe('<ul><li><p>a</p></li><li><p>b</p></li></ul>')
    expect(body('3. a')).toBe('<ol start="3"><li><p>a</p></li></ol>')
    expect(body('- a\n  - b')).toBe('<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>')
  })

  it('formats quotes and code blocks, leaving what is in the code alone', () => {
    expect(body('> **a**')).toBe('<blockquote><p><strong>a</strong></p></blockquote>')
    expect(body('```\n**a** <b>\n```')).toBe('<pre><code>**a** &lt;b&gt;</code></pre>')
  })

  it('shows what follows the opening of a code block', () => {
    expect(body('```js\na\n```')).toBe('<p class="ink-md__lang">js</p><pre><code>a</code></pre>')
    expect(body('```WARNING: sends entire balance\na\n```')).toContain('WARNING: sends entire balance')
    expect(body('~~~WARNING\na\n~~~')).toContain('WARNING')
  })

  it('keeps line breaks within a paragraph, for the stylesheet to show', () => {
    expect(body('a\nb')).toBe('<p>a\nb</p>')
  })
})

describe('Markdown: everything else stays text', () => {
  it("doesn't load an image", () => {
    expect(body('![a](https://evil.example/pixel.png)')).toBe('<p>![a](https://evil.example/pixel.png)</p>')
  })

  it("doesn't draw HTML, or hide a comment", () => {
    expect(body('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>')
    expect(body('a <b>c</b>')).toBe('<p>a &lt;b&gt;c&lt;/b&gt;</p>')
    expect(body('<!-- hidden -->')).toBe('<p>&lt;!-- hidden --&gt;</p>')
    expect(body('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  })

  it("doesn't decode entities, so none can hide a character", () => {
    expect(body('a&#x200B;b &amp; &lt;')).toBe('<p>a&amp;#x200B;b &amp;amp; &amp;lt;</p>')
  })

  it('leaves strikethrough, task lists and rules as written', () => {
    expect(body('~~a~~')).toBe('<p>~~a~~</p>')
    expect(body('- [x] **a**\n- [ ] b')).toBe('<ul><li><p>[x] <strong>a</strong></p></li><li><p>[ ] b</p></li></ul>')
    expect(body('- [x]\n\n  a')).toContain('[x]')
    expect(body('---')).toBe('<p>---</p>')
  })

  it('shows every word the agent wrote, wherever it puts it', () => {
    const shown = html(
      [
        '# heading HEADING #',
        '[a](https://x.example "LINKTITLE")',
        '[b](http://x.example "PLAINTITLE")',
        '[c][r]',
        '[r]: https://x.example "DEFINITIONTITLE"',
        '[DEFINITIONLABEL]: https://x.example',
        '![IMAGEALT](https://x.example "IMAGETITLE")',
        '<!-- COMMENT -->',
        '<div title="ATTRIBUTE"></div>',
        '<span data-x="INLINEATTRIBUTE"></span>',
        '```FENCEINFO more words\ncode\n```',
        '| a |\n|---|\n| b | SURPLUSCELL |',
        '- [x] TASK',
        '~~STRIKETHROUGH~~',
        '> QUOTE',
      ].join('\n\n'),
    )
    for (const word of [
      'HEADING', 'LINKTITLE', 'PLAINTITLE', 'DEFINITIONTITLE', 'DEFINITIONLABEL', 'IMAGEALT', 'IMAGETITLE', 'COMMENT',
      'ATTRIBUTE', 'INLINEATTRIBUTE', 'FENCEINFO more words', 'SURPLUSCELL', 'TASK', 'STRIKETHROUGH', 'QUOTE',
    ]) {
      expect(shown).toContain(word)
    }
  })

  it('only ever draws the approved tags and attributes', () => {
    const shown = html(
      [
        '# h', '**b** *i* `c` ~~d~~', '[l](https://x.example "t")', '![i](https://x.example)', '<a href="https://x.example" onclick="x" style="y">z</a>',
        '<iframe src="https://x.example"></iframe>', '- a\n- b', '2. c', '> q', '```js\nd\n```', '    e', '---', '| t |\n|:-:|\n| u |', '[r]: https://x.example',
      ].join('\n\n'),
    )
    const tags = [...shown.matchAll(/<\/?([a-z0-9]+)([^>]*)>/g)]
    expect(new Set(tags.map((tag) => tag[1]))).toEqual(
      new Set(['div', 'h3', 'p', 'strong', 'em', 'code', 'a', 'span', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td']),
    )
    expect(new Set(tags.map((tag) => tag[2]))).toEqual(
      new Set([
        '',
        ' class="ink-md"',
        ' class="ink-md__url"',
        ' class="ink-md__table"',
        ' class="ink-md__lang"',
        ' start="2"',
        ' data-align="center"',
        ' href="https://x.example/" target="_blank" rel="noopener noreferrer"',
      ]),
    )
  })
})

describe('Markdown: links', () => {
  const open = (url: string) => `<a href="${url}" target="_blank" rel="noopener noreferrer">`

  it('makes an https link clickable, with its real address showing', () => {
    expect(body('[free money](https://evil.example/a)')).toBe(
      `<p>${open('https://evil.example/a')}free money <span class="ink-md__url">(https://evil.example/a)</span></a></p>`,
    )
    expect(body('[https://good.example](https://evil.example)')).toContain('https://good.example <span class="ink-md__url">(https://evil.example/)</span>')
    expect(body('[**a**](https://evil.example)')).toContain('<strong>a</strong> <span')
  })

  it('makes a bare https URL clickable, leaving out what follows it', () => {
    expect(body('<https://a.example>')).toBe(`<p>${open('https://a.example/')}https://a.example/</a></p>`)
    expect(body('See https://a.example/b_c.')).toBe(`<p>See ${open('https://a.example/b_c')}https://a.example/b_c</a>.</p>`)
  })

  it('shows where a reference link goes, and its definition', () => {
    const shown = body('[a][r]\n\n[r]: https://evil.example')
    expect(shown).toContain(`${open('https://evil.example/')}a <span`)
    expect(shown).toContain('<p>[r]: https://evil.example</p>')
  })

  it('leaves anything but https as text, with its address showing', () => {
    expect(body('[a](http://x.example)')).toBe('<p>a (http://x.example)</p>')
    expect(body('[a](javascript:alert(1))')).toBe('<p>a (javascript:alert(1))</p>')
    expect(body('[a](data:text/html,x)')).toBe('<p>a (data:text/html,x)</p>')
    expect(body('[a](file:///etc/passwd)')).toBe('<p>a (file:///etc/passwd)</p>')
    expect(body('[a](mailto:b@c.example)')).toBe('<p>a (mailto:b@c.example)</p>')
    expect(body('[a](foo/bar)')).toBe('<p>a (foo/bar)</p>')
    expect(body('http://x.example')).toBe('<p>http://x.example</p>')
    expect(body('www.x.example')).toBe('<p>www.x.example</p>')
    expect(body('b@c.example')).toBe('<p>b@c.example</p>')
  })

  it("won't open a URL carrying credentials", () => {
    expect(body('[a](https://app.ottopus.xyz@evil.example)')).toBe('<p>a (https://app.ottopus.xyz@evil.example)</p>')
    expect(body('https://app.ottopus.xyz@evil.example')).not.toContain('<a')
  })

  it('shows a lookalike host as the punycode it really is', () => {
    const shown = body('[app](https://аpp.example)')
    expect(shown).toContain('href="https://xn--pp-6kc.example/"')
    expect(shown).toContain('(https://xn--pp-6kc.example/)')
  })

  it('never draws a link inside a link', () => {
    const shown = body('[a <https://b.example> c](https://d.example)')
    expect(shown.match(/<a /g)).toHaveLength(1)
    expect(shown).toContain('&lt;https://b.example&gt;')
  })

  it('shows a link title as text, never only on hover', () => {
    expect(body('[a](https://x.example "WARNING")')).toBe(
      `<p>${open('https://x.example/')}a &quot;WARNING&quot; <span class="ink-md__url">(https://x.example/)</span></a></p>`,
    )
    expect(body('[a](http://x.example "WARNING")')).toBe('<p>a &quot;WARNING&quot; (http://x.example)</p>')
    expect(body('[a][r]\n\n[r]: https://x.example "WARNING"')).toContain('a &quot;WARNING&quot; <span')
    expect(body('[a](https://x.example)')).not.toContain('title')
  })

  it('shows no link at all inside code', () => {
    expect(body('`https://a.example`')).toBe('<p><code>https://a.example</code></p>')
  })
})

describe('Markdown: tables', () => {
  it('draws a table with its formatting and alignment', () => {
    expect(body('| Token | **Amount** |\n|---|--:|\n| ETH | `1` |')).toBe(
      '<div class="ink-md__table"><table><thead><tr><th>Token</th><th data-align="right"><strong>Amount</strong></th></tr></thead>' +
        '<tbody><tr><td>ETH</td><td data-align="right"><code>1</code></td></tr></tbody></table></div>',
    )
  })

  it('holds links and HTML to the same rules in a cell', () => {
    const shown = body('| a | b |\n|---|---|\n| [c](https://d.example) | <img src=x> |')
    expect(shown).toContain('c <span class="ink-md__url">(https://d.example/)</span>')
    expect(shown).toContain('<td>&lt;img src=x&gt;</td>')
  })

  it('keeps an escaped pipe in its cell', () => {
    expect(body('| a |\n|---|\n| b \\| c |')).toContain('<td>b | c</td>')
  })

  it('leaves pipes with no header line as text', () => {
    expect(body('| a |\n| b |')).toBe('<p>| a |\n| b |</p>')
  })

  it('shows the source of a table with more cells in a row than its header', () => {
    const text = '| Asset |\n|---|\n| ETH | WARNING: sends entire balance |'
    expect(body(text)).toBe(`<p>${text}</p>`)
  })

  it('catches extra cells that look escaped, or in a quote or a list', () => {
    expect(body('| a |\n|---|\n| b \\\\| WARNING |')).toContain('WARNING')
    expect(body('> | a |\n> |---|\n> | b | WARNING |')).toContain('WARNING')
    expect(body('- | a |\n  |---|\n  | b | WARNING |')).toContain('WARNING')
  })

  it('keeps every other row of a table with one row too wide in its source', () => {
    const shown = body('| a |\n|---|\n| b |\n| c | WARNING |\n| d |')
    expect(shown).not.toContain('<table>')
    for (const word of ['| b |', '| c | WARNING |', '| d |']) expect(shown).toContain(word)
  })

  it('still draws a table whose rows are short, or end in an empty cell', () => {
    expect(body('| a | b |\n|---|---|\n| c |')).toContain('<td>c</td><td></td>')
    expect(body('| a |\n|---|\n| b ||')).toContain('<td>b</td>')
  })

  it('still draws a table with formatting, entities and escapes in its cells', () => {
    const shown = body('| **a** | `b` |\n|---|:-:|\n| c \\| d | &amp; [e](https://f.example "g") |\n| \\*h\\* | <i> |')
    expect(shown).toContain('<table>')
    expect(shown).toContain('<td>c | d</td>')
    expect(shown).toContain('&amp;amp; ')
  })
})

describe('Markdown: replies built to break it', () => {
  it('stays plain text past the limit', () => {
    const text = `**a** ${'b'.repeat(MAX_MARKDOWN_CHARS)}`
    expect(body(text)).toBe(`<p>${text}</p>`)
  })

  it('still formats a reply exactly at the limit', () => {
    const text = `**a** ${'b'.repeat(MAX_MARKDOWN_CHARS - 6)}`
    expect(text).toHaveLength(MAX_MARKDOWN_CHARS)
    expect(body(text)).toContain('<strong>a</strong>')
  })

  it('shows the source of quotes nested too deep to draw', () => {
    const shown = body(`${'> '.repeat(100)}deep`)
    expect(shown.match(/<blockquote>/g)).toHaveLength(9)
    expect(shown).toContain('deep')
  })

  it('shows lists and emphasis nested too deep to draw', () => {
    const list = Array.from({ length: 40 }, (_, depth) => `${'  '.repeat(depth)}- item${depth}`).join('\n')
    const shown = body(list)
    expect(shown.match(/<ul>/g)?.length).toBeLessThanOrEqual(10)
    expect(shown).toContain('item39')
    const emphasis = `${'*a '.repeat(50)}${'b* '.repeat(50)}`
    expect(body(emphasis)).toContain('b')
  })

  it('falls back to plain text when nesting overflows the parser', () => {
    const text = '>'.repeat(MAX_MARKDOWN_CHARS)
    expect(html(text)).toContain('&gt;&gt;&gt;')
    expect(() => html('1. '.repeat(MAX_MARKDOWN_CHARS / 3))).not.toThrow()
  })

  it("isn't held up by unmatched emphasis", () => {
    expect(html('*a '.repeat(MAX_MARKDOWN_CHARS / 3))).toContain('*a')
    expect(html('_a '.repeat(MAX_MARKDOWN_CHARS / 3))).toContain('_a')
  })

  it('draws tables built to be huge', () => {
    const columns = '|a'.repeat(MAX_MARKDOWN_CHARS / 7)
    expect(html(`${columns}|\n${'|-'.repeat(MAX_MARKDOWN_CHARS / 7)}|\n${columns}|`)).toContain('<table>')
    expect(html(`|a|\n|-|\n${'|1|\n'.repeat(MAX_MARKDOWN_CHARS / 5)}`)).toContain('<table>')
  })

  describe('a short reply asking for a huge table', () => {
    /** A header this wide pads every one of these short rows to its width. */
    const table = (columns: number, rows: number, line = '\n') =>
      `${'|a'.repeat(columns)}|${line}${'|-'.repeat(columns)}|${line}${`|x|${line}`.repeat(rows)}`

    it('stays plain text instead of making millions of cells', () => {
      const text = table(1000, 3000)
      expect(text.length).toBeLessThan(MAX_MARKDOWN_CHARS)
      expect(html(text)).not.toContain('<table>')
      expect(html(text)).toContain('|x|')
    })

    it('stays plain text at the worst size the length limit allows', () => {
      expect(html(table(2400, 2400))).not.toContain('<table>')
    })

    it("can't get past the limit with other line endings, or inside a quote", () => {
      expect(html(table(1000, 3000, '\r'))).not.toContain('<table>')
      expect(html(table(1000, 3000, '\r\n'))).not.toContain('<table>')
      expect(html(`> ${table(1000, 1000, '\n> ')}`)).not.toContain('<table>')
    })

    it('still draws a table just under the limit', () => {
      const shown = html(table(100, 180))
      expect(102 * 183).toBeLessThanOrEqual(MAX_TABLE_CELLS)
      expect(shown.match(/<td/g)).toHaveLength(18_000)
    })

    it('falls back just over the limit', () => {
      expect(102 * 201).toBeGreaterThan(MAX_TABLE_CELLS)
      expect(html(table(100, 198))).not.toContain('<table>')
    })

    it('leaves a long reply with an ordinary table and no other pipes alone', () => {
      const prose = 'A line of ordinary prose.\n'.repeat(400)
      expect(html(`${prose}\n| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |`)).toContain('<table>')
    })

    it('leaves a reply with no pipes alone, however many lines it has', () => {
      expect(html('a\n'.repeat(MAX_MARKDOWN_CHARS / 2))).toContain('<p>')
      expect(html('**a**\n'.repeat(1000))).toContain('<strong>')
    })
  })

  describe('a short reply repeating a long link', () => {
    const definition = (chars: number) => `[r]: https://a.example/${'a'.repeat(chars - 'https://a.example/'.length)}`

    it('stays plain text instead of showing the address thousands of times', () => {
      const text = `${definition(15_000)}\n\n${'[r] '.repeat(1000)}`
      expect(text.length).toBeLessThan(MAX_MARKDOWN_CHARS)
      expect(html(text)).not.toContain('<a ')
      expect(html(text).length).toBeLessThan(text.length * 2)
    })

    it('counts a long title too', () => {
      const text = `[r]: https://a.example "${'t'.repeat(15_000)}"\n\n${'[r] '.repeat(1000)}`
      expect(html(text)).not.toContain('<a ')
    })

    it('falls back only past the limit', () => {
      const uses = (count: number) => `${definition(1000)}\n\n${'[r] '.repeat(count)}`
      expect(MAX_REFERENCED_CHARS).toBe(100_000)
      expect(html(uses(99)).match(/<a /g)).toHaveLength(99)
      expect(html(uses(101))).not.toContain('<a ')
    })

    it('leaves ordinary references and inline links alone', () => {
      const shown = html(`[a][r] and [b][r] and [c](https://c.example).\n\n${definition(200)}`)
      expect(shown.match(/<a /g)).toHaveLength(3)
    })
  })

  it('still shows text built to slow down autolinks', () => {
    expect(html(`${'a'.repeat(MAX_MARKDOWN_CHARS - 1)}@`)).toContain('a@')
  })
})
