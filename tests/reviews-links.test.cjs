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

test('friendly names keep project codes, accents and version titles readable', async () => {
  const { shareAliasBase, buildNamedShareUrl, isShareAlias } = await links;
  const alias = shareAliasBase({ title: 'QM-0003_Stella-Cartel' }, { title: 'Montaje · V1' }, { name: 'sc_offline.mp4' });
  assert.equal(alias, 'qm-0003-stella-cartel-montaje-v1');
  assert.equal(shareAliasBase({ title: 'PHD-0001_Raid-Miniatura' }, { title: 'Revisión 2' }), 'phd-0001-raid-miniatura-revision-2');
  assert.equal(buildNamedShareUrl('https://gb-films.github.io/GB-Studio/?app=reviews#old', alias), 'https://gb-films.github.io/GB-Studio/?app=reviews&link=qm-0003-stella-cartel-montaje-v1');
  assert.equal(buildNamedShareUrl('https://gb-films.github.io/GB-Studio/mira/#/old', alias), 'https://gb-films.github.io/GB-Studio/?app=reviews&link=qm-0003-stella-cartel-montaje-v1');
  assert.equal(isShareAlias('../other'), false);
  assert.equal(isShareAlias(''), false);
  assert.equal(shareAliasBase({ title: 'QM-0003_' + 'title '.repeat(80) }, { title: 'V1' }).length <= 120, true);
  assert.match(shareAliasBase({ title: 'QM-0003_Stella-Cartel' }, { title: 'Montaje V1' }, { name: 'Final 2.mp4' }, true), /-final-2$/);
});

test('alias reservations keep names unique and never change old destinations', async () => {
  const { reserveShareAlias, sameShareTarget, resolveShareHash } = await links;
  const stored = new Map();
  const first = { token: 'A'.repeat(22), fileId: 'file-1', projectId: 'project-1', versionId: 'version-1' };
  const second = { ...first, fileId: 'file-2' };
  const reserve = target => reserveShareAlias('qm-0003-stella-v1', async alias => {
    if (stored.has(alias)) return sameShareTarget(stored.get(alias), target);
    stored.set(alias, target); return true;
  });
  const a = await reserve(first), b = await reserve(second);
  assert.equal(a, 'qm-0003-stella-v1');
  assert.equal(b, 'qm-0003-stella-v1-2');
  assert.equal(await reserve(first), a);
  assert.equal(await resolveShareHash('#/' + a, alias => stored.get(alias)), 'share=' + first.token + '&file=file-1');
  assert.equal(await resolveShareHash('#/' + b, alias => stored.get(alias)), 'share=' + second.token + '&file=file-2');
  await assert.rejects(resolveShareHash('#/unknown', alias => stored.get(alias)));
  await assert.rejects(resolveShareHash('#/../private', alias => stored.get(alias)));
  const previous = 'share=' + 'B'.repeat(43) + '&file=client-video';
  assert.equal(await resolveShareHash('#' + previous, () => { throw Error('Legacy links must not resolve an alias'); }), previous);
});
