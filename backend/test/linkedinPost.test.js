import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { isLinkedInUrl, extractLinkedInPost, downloadLinkedInItems, buildItemNotes } from '../src/services/linkedinPost.js'

const ld = {
  '@type': 'SocialMediaPosting', '@id': 'https://www.linkedin.com/posts/jane-example_demo-activity-7530619949187248128-AbCd',
  datePublished: '2026-11-23T13:15:08.038Z', articleBody: 'Behind the scenes of our new reel.\n\nFull project https://lnkd.in/x #motion',
  author: { '@type': 'Person', name: 'Jane Example', url: 'https://www.linkedin.com/in/jane-example' },
  image: [{ url: 'https://media.example/a/1?e=1' }, { url: 'https://media.example/a/2?e=1' }, { url: 'https://media.example/a/2?e=2' }, { url: 'https://media.example/a/3' }],
}
const html = `<html><head><meta property="og:url" content="https://www.linkedin.com/posts/jane-example_demo-activity-7530619949187248128-AbCd"></head>
<script type="application/ld+json">${JSON.stringify(ld)}</script></html>`

test('isLinkedInUrl', () => {
  assert.ok(isLinkedInUrl('https://lnkd.in/p/abc'))
  assert.ok(isLinkedInUrl('https://www.linkedin.com/posts/x'))
  assert.ok(!isLinkedInUrl('https://notlinkedin.com/x'))
  assert.ok(!isLinkedInUrl('https://example.com/?u=linkedin.com'))
})

test('extracts every media item, de-duplicated, with post details', () => {
  const { items, post } = extractLinkedInPost(html)
  assert.equal(items.length, 3)
  assert.deepEqual(items.map((i) => i.kind), ['image', 'image', 'image'])
  assert.equal(post.author, 'Jane Example')
  assert.equal(post.postId, '7530619949187248128')
  assert.match(post.description, /^Behind the scenes/)
})

test('extracts several <video> tags (data-sources) and JSON-LD videos', () => {
  const src = (u) => JSON.stringify([{ src: u, type: 'video/mp4' }]).replace(/"/g, '&quot;')
  const page = `<video class="x" data-sources="${src('https://v.example/one.mp4')}"></video><video data-sources="${src('https://v.example/two.mp4')}"></video>
    <script type="application/ld+json">${JSON.stringify({ '@type': 'VideoObject', contentUrl: 'https://v.example/two.mp4?x=1', creator: { name: 'Jo' } })}</script>`
  const { items, post } = extractLinkedInPost(page)
  assert.deepEqual(items.map((i) => i.url), ['https://v.example/one.mp4', 'https://v.example/two.mp4'])
  assert.equal(post.author, 'Jo')
})

test('downloads GIFs (converted) and videos, skips stills, writes per-item notes', async () => {
  const media = mkdtempSync(path.join(os.tmpdir(), 'li-media-'))
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'li-tmp-'))
  const bodies = [['image/gif', 'GIF89a-one'], ['video/mp4', 'MP4-two'], ['image/jpeg', 'JPEG-three']]
  let i = 0
  const fetchImpl = async () => {
    const [type, body] = bodies[i++]
    return new Response(body, { status: 200, headers: { 'content-type': type } })
  }
  const logs = []
  const converted = []
  const { items, post } = extractLinkedInPost(html)
  const files = await downloadLinkedInItems({
    items, post, finalUrl: post.source, mediaDir: media, tmpDir: tmp, send: (l) => logs.push(l), fetchImpl,
    convert: async (src, dest) => { converted.push(src); await import('fs').then((fs) => fs.promises.writeFile(dest, 'CONVERTED')) },
  })
  assert.equal(files.length, 2)
  assert.equal(converted.length, 1)
  const names = readdirSync(media).sort()
  assert.deepEqual(names, files.map((f) => f.filename).sort())
  assert.match(files[0].filename, /^\[7530619949187248128-1\] Behind the scenes of our new reel\. Full project \(1 of 3\)\.mp4$/)
  assert.equal(readFileSync(path.join(media, files[0].filename), 'utf8'), 'CONVERTED')
  assert.equal(readFileSync(path.join(media, files[1].filename), 'utf8'), 'MP4-two')
  assert.match(files[0].notes, /^Author: Jane Example \(https:\/\/www\.linkedin\.com\/in\/jane-example\)\nSource: .*\nPlatform: LinkedIn\nPosted: 2026-11-23\n\nBehind the scenes/)
  assert.match(files[0].notes, /Item 1 of 3 in this post$/)
  assert.ok(logs.some((l) => /still image/.test(l)))
  assert.equal(buildItemNotes({ author: 'A' }, 'https://x/', 1, 1).includes('Item'), false)
})
