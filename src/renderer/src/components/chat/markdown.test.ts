import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MAX_MARKDOWN_CHARS, Markdown } from './markdown'

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
    expect(body('```js\n**a** <b>\n```')).toBe('<pre><code>**a** &lt;b&gt;</code></pre>')
  })

  it('keeps line breaks within a paragraph, for the stylesheet to show', () => {
    expect(body('a\nb')).toBe('<p>a\nb</p>')
  })
})

describe('Markdown: everything else stays text', () => {
  it('shows a link as its label and full URL, with nothing to click', () => {
    expect(body('[free money](https://evil.example/a?b=1)')).toBe('<p>free money (https://evil.example/a?b=1)</p>')
    expect(body('[https://good.example](https://evil.example)')).toBe('<p>https://good.example (https://evil.example)</p>')
    expect(body('[**a**](https://evil.example)')).toBe('<p><strong>a</strong> (https://evil.example)</p>')
    expect(body('<https://a.example>')).toBe('<p>https://a.example</p>')
    expect(body('https://a.example')).toBe('<p>https://a.example</p>')
  })

  it('shows where a reference link goes, and its definition', () => {
    const shown = body('[a][r]\n\n[r]: https://evil.example')
    expect(shown).toContain('<p>a (https://evil.example)</p>')
    expect(shown).toContain('<p>[r]: https://evil.example</p>')
  })

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

  it('leaves tables, strikethrough, task lists and rules as written', () => {
    expect(body('| a |\n|---|\n| 1 |')).toBe('<p>| a |\n|---|\n| 1 |</p>')
    expect(body('~~a~~')).toBe('<p>~~a~~</p>')
    expect(body('- [x] a')).toBe('<ul><li><p>[x] a</p></li></ul>')
    expect(body('---')).toBe('<p>---</p>')
  })

  it('only ever draws the approved tags, and no attribute but a list start', () => {
    const shown = html(
      [
        '# h', '**b** *i* `c` ~~d~~', '[l](https://x.example "t")', '![i](https://x.example)', '<a href="https://x.example" onclick="x" style="y">z</a>',
        '<iframe src="https://x.example"></iframe>', '- a\n- b', '2. c', '> q', '```js\nd\n```', '    e', '---', '| t |\n|---|', '[r]: https://x.example',
      ].join('\n\n'),
    )
    const tags = [...shown.matchAll(/<\/?([a-z0-9]+)([^>]*)>/g)]
    expect(new Set(tags.map((tag) => tag[1]))).toEqual(new Set(['div', 'h3', 'p', 'strong', 'em', 'code', 'ul', 'ol', 'li', 'blockquote', 'pre']))
    expect(new Set(tags.map((tag) => tag[2]))).toEqual(new Set(['', ' class="ink-md"', ' start="2"']))
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
})
