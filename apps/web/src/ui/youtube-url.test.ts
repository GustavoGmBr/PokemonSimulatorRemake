import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedUrl } from './youtube-url.ts';

test('links do YouTube viram URL de player', () => {
  assert.match(embedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')!, /embed\/dQw4w9WgXcQ\?autoplay=1/);
  assert.match(embedUrl('youtu.be/dQw4w9WgXcQ?t=5')!, /embed\/dQw4w9WgXcQ/);
  assert.match(embedUrl('https://www.youtube.com/live/abcdefghijk')!, /embed\/abcdefghijk/);
  assert.match(embedUrl('https://www.youtube.com/shorts/abcdefghijk')!, /embed\/abcdefghijk/);
  assert.match(embedUrl('https://www.youtube.com/playlist?list=PLabcdefghij123')!, /videoseries\?list=PLabcdefghij123/);
  assert.match(embedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij123')!, /list=PLabcdefghij123/);
});

test('links inválidos ou de outros sites são recusados', () => {
  assert.equal(embedUrl(''), null);
  assert.equal(embedUrl('https://evil.example/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(embedUrl('https://www.youtube.com/watch?v=<script>'), null);
  assert.equal(embedUrl('javascript:alert(1)'), null);
});
