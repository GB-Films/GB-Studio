const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const links = import(pathToFileURL(path.join(__dirname, '..', 'reviews-links.js')).href);

test('new share capabilities are 128-bit random IDs; old tokens remain valid', async () => {
  const { createShareToken, isShareToken } = await links;
  const ids = Array.from({ length: 100 }, createShareToken);
  assert.equal(new Set(ids).size, 100);
  ids.forEach(id => { assert.equal(id.length, 22); assert.ok(isShareToken(id)); });
  assert.ok(isShareToken('A'.repeat(43)));
  assert.equal(isShareToken('short'), false);
});

test('short links preserve the exact shared file and tokens, including legacy links', async () => {
  const { buildShareUrl, expandShareHash } = await links;
  for (const token of ['A'.repeat(22), 'B'.repeat(43)]) {
    for (const file of ['00dcf4ab-56d0-43da-bc83-629762f3c97e', 'client-video', 'foto con espacios']) {
      const link = new URL(buildShareUrl('https://gb-films.github.io/GB-Studio/?app=reviews', token, file));
      assert.equal(link.pathname, '/GB-Studio/mira/');
      assert.equal(link.search, '');
      const expanded = new URLSearchParams(expandShareHash(link.hash));
      assert.equal(expanded.get('share'), token);
      assert.equal(expanded.get('file'), file);
    }
  }
  const legacy = 'share=' + 'B'.repeat(43) + '&file=client-video';
  assert.equal(expandShareHash('#' + legacy), legacy);
  assert.equal(expandShareHash(''), '');
  assert.throws(() => expandShareHash('#bad'));
  assert.throws(() => expandShareHash('#' + 'A'.repeat(22) + '.bad'));
  const token = 'A'.repeat(22), file = '00dcf4ab-56d0-43da-bc83-629762f3c97e';
  const short = buildShareUrl('https://gb-films.github.io/GB-Studio/', token, file);
  assert.ok(short.length < 90);
  assert.equal(buildShareUrl('https://gb-films.github.io/GB-Studio/mira/', token, file), short);
});
