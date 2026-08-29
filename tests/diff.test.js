const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const JSZip = require('../vendor/jszip.min.js');

const InstaDiff = require('../app.js');

function accounts(...usernames) {
  return usernames.map((username) => ({ username, name: '' }));
}

function sorted(set) {
  return Array.from(set).sort();
}

test('normalizeUsername strips @, whitespace, URLs and casing', () => {
  assert.strictEqual(InstaDiff.normalizeUsername('  @Alice '), 'alice');
  assert.strictEqual(InstaDiff.normalizeUsername('BOB'), 'bob');
  assert.strictEqual(InstaDiff.normalizeUsername('https://www.instagram.com/Charlie/'), 'charlie');
  assert.strictEqual(InstaDiff.normalizeUsername(null), '');
});

test('normalizeUsername unwraps Instagram linkshim redirect URLs from HTML exports', () => {
  const shimmed = 'https://l.instagram.com/?u=https%3A%2F%2Fwww.instagram.com%2Fdave%2F&e=abc123';
  assert.strictEqual(InstaDiff.normalizeUsername(shimmed), 'dave');
  // works regardless of parameter order
  const reordered = 'https://l.instagram.com/?e=abc123&u=https%3A%2F%2Fwww.instagram.com%2Feve%2F';
  assert.strictEqual(InstaDiff.normalizeUsername(reordered), 'eve');
  // the encoded destination URL may itself contain '=' characters (e.g. query params)
  const withEquals = 'https://l.instagram.com/?u=https%3A%2F%2Fwww.instagram.com%2Ffrank%2F%3Ffoo%3Dbar&e=abc123';
  assert.strictEqual(InstaDiff.normalizeUsername(withEquals), 'frank');
});

test('new non-followers excludes accounts that were already non-followers', () => {
  const previous = {
    followers: accounts('mutual'),
    following: accounts('mutual', 'alice', 'bob', 'charlie')
  };
  const current = {
    followers: accounts('mutual'),
    following: accounts('mutual', 'alice', 'bob', 'charlie', 'david', 'eve')
  };
  const diff = InstaDiff.computeDiff(previous, current);
  assert.deepStrictEqual(sorted(diff.newNonFollowers), ['david', 'eve']);
  assert.deepStrictEqual(sorted(diff.currentNonFollowers), ['alice', 'bob', 'charlie', 'david', 'eve']);
});

test('unfollowed me while I still follow them', () => {
  const previous = {
    followers: accounts('alice', 'bob', 'charlie'),
    following: accounts('alice', 'charlie')
  };
  const current = {
    // alice and bob unfollowed, charlie still follows
    followers: accounts('charlie'),
    following: accounts('alice', 'charlie')
  };
  const diff = InstaDiff.computeDiff(previous, current);
  assert.deepStrictEqual(sorted(diff.unfollowedMeStillFollow), ['alice']);
  assert.deepStrictEqual(sorted(diff.lostFollowers), ['alice', 'bob']);
});

test('deduplicates and counts accounts', () => {
  const previous = { followers: accounts('alice'), following: accounts('alice') };
  const current = {
    followers: accounts('alice', '@Alice', ' alice '),
    following: accounts('alice', 'bob', 'bob')
  };
  const diff = InstaDiff.computeDiff(previous, current);
  assert.strictEqual(diff.counts.currentFollowers, 1);
  assert.strictEqual(diff.counts.currentFollowing, 2);
  assert.deepStrictEqual(sorted(diff.mutuals), ['alice']);
  assert.deepStrictEqual(sorted(diff.iStartedFollowing), ['bob']);
});

test('classifyFile recognises numbered followers files and skips unrelated lists', () => {
  assert.strictEqual(InstaDiff.classifyFile('connections/followers_and_following/followers_1.json'), 'followers');
  assert.strictEqual(InstaDiff.classifyFile('followers_2.json'), 'followers');
  assert.strictEqual(InstaDiff.classifyFile('following.html'), 'following');
  assert.strictEqual(InstaDiff.classifyFile('pending_follow_requests.json'), null);
  assert.strictEqual(InstaDiff.classifyFile('__MACOSX/followers_1.json'), null);
});

test('parses Instagram JSON and HTML list formats', () => {
  const followersJson = JSON.stringify([
    {
      title: '',
      string_list_data: [{ href: 'https://www.instagram.com/alice', value: 'alice', timestamp: 1 }]
    }
  ]);
  assert.deepStrictEqual(InstaDiff.parseJsonList(followersJson), [{ username: 'alice', name: '' }]);

  const followingJson = JSON.stringify({
    relationships_following: [
      { title: 'Bob B', string_list_data: [{ href: 'https://www.instagram.com/bob', value: 'bob' }] }
    ]
  });
  assert.deepStrictEqual(InstaDiff.parseJsonList(followingJson), [{ username: 'bob', name: 'Bob B' }]);

  const html = '<div><a href="https://www.instagram.com/Carol">Carol</a></div>';
  assert.deepStrictEqual(InstaDiff.parseHtmlList(html), [{ username: 'carol', name: '' }]);

  const shimmedHtml = '<div><a href="https://l.instagram.com/?u=https%3A%2F%2Fwww.instagram.com%2Fdave%2F&amp;e=abc123">dave</a></div>';
  assert.deepStrictEqual(InstaDiff.parseHtmlList(shimmedHtml), [{ username: 'dave', name: '' }]);
});

function listJson(usernames) {
  return JSON.stringify(usernames.map((username) => ({
    title: '',
    string_list_data: [{ href: 'https://www.instagram.com/' + username, value: username }]
  })));
}

function buildZip(files) {
  const zip = new JSZip();
  Object.keys(files).forEach((name) => zip.file(name, files[name]));
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('parseExportZip merges multiple followers files', async () => {
  const buffer = await buildZip({
    'connections/followers_and_following/followers_1.json': listJson(['alice', 'bob']),
    'connections/followers_and_following/followers_2.json': listJson(['carol']),
    'connections/followers_and_following/following.json': JSON.stringify({
      relationships_following: JSON.parse(listJson(['alice', 'dave']))
    })
  });
  const parsed = await InstaDiff.parseExportZip(buffer, JSZip);
  assert.deepStrictEqual(parsed.files.followers, ['followers_1.json', 'followers_2.json']);
  assert.deepStrictEqual(parsed.files.following, ['following.json']);
  assert.strictEqual(parsed.followers.length, 3);
  assert.strictEqual(parsed.following.length, 2);
});

test('parseExportZip reports exports without recognisable data', async () => {
  const buffer = await buildZip({ 'readme.txt': 'nothing here' });
  buffer.name = 'export.zip';
  await assert.rejects(
    () => InstaDiff.parseExportZip(buffer, JSZip),
    /"export\.zip" does not contain recognisable followers\/following data/
  );
});

test('bundled JSZip vendor file exists', () => {
  assert.ok(require('node:fs').existsSync(path.join(__dirname, '..', 'vendor', 'jszip.min.js')));
});
