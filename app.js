/*
 * Instagram List Diff - 100% client-side.
 * Nothing in this file sends data anywhere: everything happens in the browser.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api; // for the node based unit tests
  } else {
    root.InstaDiff = api;
    if (typeof document !== 'undefined') {
      document.addEventListener('DOMContentLoaded', api.initUI);
    }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Pure helpers: normalisation and set logic
   * ------------------------------------------------------------------ */

  function normalizeUsername(value) {
    if (typeof value !== 'string') return '';
    var name = value.trim();
    // Unwrap Instagram's "linkshim" redirect URLs used in HTML exports,
    // e.g. https://l.instagram.com/?u=https%3A%2F%2Fwww.instagram.com%2Fsomeuser%2F&e=...
    var shimMatch = name.match(/^https?:\/\/l\.instagram\.com\/[^?]*\?([^#]*)/i);
    if (shimMatch) {
      var params = shimMatch[1].split('&');
      for (var i = 0; i < params.length; i++) {
        var eq = params[i].indexOf('=');
        var key = eq === -1 ? params[i] : params[i].slice(0, eq);
        var val = eq === -1 ? '' : params[i].slice(eq + 1);
        if (key === 'u' && val) {
          try {
            name = decodeURIComponent(val);
          } catch (err) {
            name = val;
          }
          break;
        }
      }
    }
    // Accept full profile URLs as well as plain usernames.
    var urlMatch = name.match(/^https?:\/\/(?:www\.)?instagram\.com\/([^/?#]+)/i);
    if (urlMatch) name = urlMatch[1];
    name = name.replace(/^@+/, '').trim();
    name = name.replace(/\/+$/, '');
    return name.toLowerCase();
  }

  /** Build a Map<username, {username, name}> keeping the first display name found. */
  function toAccountMap(accounts) {
    var map = new Map();
    (accounts || []).forEach(function (account) {
      var username = normalizeUsername(account && account.username);
      if (!username) return;
      var existing = map.get(username);
      if (!existing) {
        map.set(username, { username: username, name: (account.name || '').trim() });
      } else if (!existing.name && account.name) {
        existing.name = String(account.name).trim();
      }
    });
    return map;
  }

  function difference(a, b) {
    var out = new Set();
    a.forEach(function (value) {
      if (!b.has(value)) out.add(value);
    });
    return out;
  }

  function intersection(a, b) {
    var out = new Set();
    a.forEach(function (value) {
      if (b.has(value)) out.add(value);
    });
    return out;
  }

  function keySet(map) {
    return new Set(map.keys());
  }

  /**
   * Compute every list from two parsed exports.
   * Each export is `{followers: Account[], following: Account[]}`.
   */
  function computeDiff(previous, current) {
    var prevFollowersMap = toAccountMap(previous.followers);
    var prevFollowingMap = toAccountMap(previous.following);
    var currFollowersMap = toAccountMap(current.followers);
    var currFollowingMap = toAccountMap(current.following);

    var prevFollowers = keySet(prevFollowersMap);
    var prevFollowing = keySet(prevFollowingMap);
    var currFollowers = keySet(currFollowersMap);
    var currFollowing = keySet(currFollowingMap);

    var currentNonFollowers = difference(currFollowing, currFollowers);
    var previousNonFollowers = difference(prevFollowing, prevFollowers);

    return {
      // Main list #1
      newNonFollowers: difference(currentNonFollowers, previousNonFollowers),
      // Main list #2
      unfollowedMeStillFollow: intersection(
        difference(prevFollowers, currFollowers),
        currFollowing
      ),
      currentNonFollowers: currentNonFollowers,
      previousNonFollowers: previousNonFollowers,
      mutuals: intersection(currFollowing, currFollowers),
      newFollowers: difference(currFollowers, prevFollowers),
      lostFollowers: difference(prevFollowers, currFollowers),
      iUnfollowed: difference(prevFollowing, currFollowing),
      iStartedFollowing: difference(currFollowing, prevFollowing),
      counts: {
        currentFollowers: currFollowers.size,
        currentFollowing: currFollowing.size,
        previousFollowers: prevFollowers.size,
        previousFollowing: prevFollowing.size
      },
      names: mergeNames([prevFollowersMap, prevFollowingMap, currFollowersMap, currFollowingMap])
    };
  }

  function mergeNames(maps) {
    var names = new Map();
    maps.forEach(function (map) {
      map.forEach(function (account, username) {
        if (account.name && !names.get(username)) names.set(username, account.name);
      });
    });
    return names;
  }

  /* ------------------------------------------------------------------ *
   * Instagram export parsing
   * ------------------------------------------------------------------ */

  var FOLLOWERS_FILE = /followers(?:_\d+)?\.(json|html)$/i;
  var FOLLOWING_FILE = /following(?:_\d+)?\.(json|html)$/i;

  function classifyFile(path) {
    var lower = String(path).toLowerCase();
    if (lower.indexOf('__macosx') !== -1) return null;
    var base = lower.split('/').pop();
    if (!base) return null;
    // Ignore lists that are neither the followers nor the following list.
    if (/pending|received|requests|hashtag|close_friends|blocked|restricted|recently|dismissed|unfollowed/.test(base)) {
      return null;
    }
    if (FOLLOWERS_FILE.test(base)) return 'followers';
    if (FOLLOWING_FILE.test(base)) return 'following';
    return null;
  }

  /** Recursively collect `{href, value, timestamp}` entries out of Instagram JSON. */
  function collectFromJson(node, out) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      node.forEach(function (item) {
        collectFromJson(item, out);
      });
      return out;
    }
    if (Array.isArray(node.string_list_data)) {
      var title = typeof node.title === 'string' ? node.title : '';
      node.string_list_data.forEach(function (entry) {
        var username = normalizeUsername(entry && entry.value) || normalizeUsername(entry && entry.href);
        if (username) out.push({ username: username, name: title });
      });
      return out;
    }
    Object.keys(node).forEach(function (key) {
      collectFromJson(node[key], out);
    });
    return out;
  }

  function parseJsonList(text) {
    var data = JSON.parse(text);
    return collectFromJson(data, []);
  }

  function parseHtmlList(text) {
    var out = [];
    var linkRe = /<a[^>]+href="([^"]*instagram\.com\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    var match;
    while ((match = linkRe.exec(text)) !== null) {
      var username = normalizeUsername(match[1]) || normalizeUsername(stripTags(match[2]));
      if (username) out.push({ username: username, name: '' });
    }
    return out;
  }

  function stripTags(html) {
    return String(html).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').trim();
  }

  /** Validate that a parsed result has both followers and following data, sort file lists, and return it. */
  function finalizeResult(result, label) {
    if (!result.followers.length && !result.following.length) {
      throw new Error(
        label + ' does not contain recognisable followers/following data. ' +
        'Select the "followers_and_following" export ZIP, or the individual ' +
        'followers_*.json/following.json files.'
      );
    }
    if (!result.followers.length) {
      throw new Error(label + ': no followers file found in the export.');
    }
    if (!result.following.length) {
      throw new Error(label + ': no following file found in the export.');
    }
    result.files.followers.sort();
    result.files.following.sort();
    return result;
  }

  /**
   * Read every followers/following entry out of an Instagram export ZIP with JSZip,
   * without validating that both lists are present (see `parseExportZip`/`finalizeResult`).
   * Returns `{followers, following, files: {followers: [], following: []}}`.
   */
  function extractZipContents(file, JSZipLib) {
    var Zip = JSZipLib || (typeof JSZip !== 'undefined' ? JSZip : null);
    if (!Zip) return Promise.reject(new Error('ZIP library (JSZip) could not be loaded.'));
    return Zip.loadAsync(file)
      .catch(function () {
        throw new Error('"' + file.name + '" could not be read as a ZIP file.');
      })
      .then(function (zip) {
        var jobs = [];
        var result = { followers: [], following: [], files: { followers: [], following: [] } };
        zip.forEach(function (path, entry) {
          if (entry.dir) return;
          var kind = classifyFile(path);
          if (!kind) return;
          jobs.push(
            entry.async('string').then(function (text) {
              addParsedFile(result, kind, path.split('/').pop(), text);
            }).catch(function () {
              /* Unreadable or malformed single file: skip it, report at the end. */
            })
          );
        });
        return Promise.all(jobs).then(function () {
          return result;
        });
      });
  }

  /**
   * Read an Instagram export ZIP file object with JSZip.
   * Returns `{followers, following, files: {followers: [], following: []}}`.
   */
  function parseExportZip(file, JSZipLib) {
    return extractZipContents(file, JSZipLib).then(function (result) {
      return finalizeResult(result, '"' + file.name + '"');
    });
  }

  /** Read a plain-text export file (JSON or HTML) selected directly, without a ZIP wrapper. */
  function readFileAsText(file) {
    if (typeof file.text === 'function') return file.text();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result));
      };
      reader.onerror = function () {
        reject(reader.error || new Error('Could not read "' + file.name + '".'));
      };
      reader.readAsText(file);
    });
  }

  /** Parse a single non-ZIP file (`.json` or `.html`) and merge it into `result`. */
  function addParsedFile(result, kind, fileName, text) {
    var accounts = /\.json$/i.test(fileName) ? parseJsonList(text) : parseHtmlList(text);
    if (!accounts.length) return;
    result[kind] = result[kind].concat(accounts);
    result.files[kind].push(fileName);
  }

  /**
   * Parse one or more files selected by the user into a single export.
   * Accepts a mix of ZIP archives and loose `.json`/`.html` files (Instagram's
   * JSON export is delivered as several unzipped files when downloaded manually).
   * Validation (both followers and following must be present) only happens once,
   * against the combined result, so a ZIP and loose files can complement each other.
   * Returns `{followers, following, files: {followers: [], following: []}}`.
   */
  function parseExportFiles(files, JSZipLib) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return Promise.reject(new Error('Please choose a file.'));

    var result = { followers: [], following: [], files: { followers: [], following: [] } };
    var label = list.length === 1 ? '"' + list[0].name + '"' : 'the selected files';

    var jobs = list.map(function (file) {
      if (/\.zip$/i.test(file.name)) {
        return extractZipContents(file, JSZipLib).then(function (parsed) {
          result.followers = result.followers.concat(parsed.followers);
          result.following = result.following.concat(parsed.following);
          result.files.followers = result.files.followers.concat(parsed.files.followers);
          result.files.following = result.files.following.concat(parsed.files.following);
        });
      }
      var kind = classifyFile(file.name);
      if (!kind) return Promise.resolve();
      return readFileAsText(file).then(function (text) {
        addParsedFile(result, kind, file.name.split('/').pop(), text);
      }).catch(function () {
        /* Unreadable or malformed single file: skip it, report at the end. */
      });
    });

    return Promise.all(jobs).then(function () {
      return finalizeResult(result, label);
    });
  }

  /* ------------------------------------------------------------------ *
   * Ignore list (localStorage - usernames only)
   * ------------------------------------------------------------------ */

  var STORAGE_KEY = 'instaDiff.ignored';

  function loadIgnored() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return new Set((Array.isArray(parsed) ? parsed : []).map(normalizeUsername).filter(Boolean));
    } catch (err) {
      return new Set();
    }
  }

  function saveIgnored(set) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch (err) {
      /* storage unavailable (private mode): ignore list is then session-only */
    }
  }

  /* ------------------------------------------------------------------ *
   * UI
   * ------------------------------------------------------------------ */

  function initUI() {
    var $ = function (id) {
      return document.getElementById(id);
    };

    var state = {
      diff: null,
      ignored: loadIgnored(),
      activeTab: 'newNonFollowers',
      query: '',
      sort: 'alpha'
    };

    var TABS = [
      { id: 'newNonFollowers', label: 'New Non-Followers', status: 'Does not follow you back (new)' },
      { id: 'unfollowedMeStillFollow', label: 'Unfollowed Me — I Still Follow', status: 'Unfollowed you, you still follow' },
      { id: 'currentNonFollowers', label: 'Current Non-Followers', status: 'Does not follow you back' },
      { id: 'other', label: 'Other Changes', status: '' },
      { id: 'ignored', label: 'Ignored', status: 'Ignored' }
    ];

    var OTHER_LISTS = [
      { id: 'mutuals', label: 'Current mutual followers' },
      { id: 'newFollowers', label: 'New followers (followed you between exports)' },
      { id: 'lostFollowers', label: 'People who unfollowed me' },
      { id: 'iUnfollowed', label: 'People I unfollowed' },
      { id: 'iStartedFollowing', label: 'People I started following' }
    ];

    var els = {
      prev: $('prevFile'),
      curr: $('currFile'),
      compare: $('compareBtn'),
      error: $('error'),
      detected: $('detected'),
      results: $('results'),
      summary: $('summary'),
      tabs: $('tabs'),
      search: $('search'),
      sort: $('sort'),
      lists: $('lists'),
      listTitle: $('listTitle'),
      copyBtn: $('copyBtn'),
      txtBtn: $('txtBtn'),
      csvBtn: $('csvBtn')
    };

    function showError(message) {
      els.error.textContent = message;
      els.error.hidden = !message;
    }

    function displayName(username) {
      return (state.diff && state.diff.names.get(username)) || '';
    }

    function currentEntries() {
      if (state.activeTab === 'ignored') {
        return [{ label: 'Ignored accounts', usernames: Array.from(state.ignored) }];
      }
      if (state.activeTab === 'other') {
        return OTHER_LISTS.map(function (list) {
          return { label: list.label, usernames: visible(state.diff[list.id]) };
        });
      }
      return [{ label: '', usernames: visible(state.diff[state.activeTab]) }];
    }

    function visible(set) {
      return Array.from(set).filter(function (username) {
        return !state.ignored.has(username);
      });
    }

    function filterAndSort(usernames) {
      var query = state.query.trim().toLowerCase();
      var list = usernames.filter(function (username) {
        if (!query) return true;
        return username.indexOf(query) !== -1 || displayName(username).toLowerCase().indexOf(query) !== -1;
      });
      list.sort(function (a, b) {
        return state.sort === 'alphaDesc' ? b.localeCompare(a) : a.localeCompare(b);
      });
      return list;
    }

    function statusFor() {
      var tab = TABS.filter(function (t) {
        return t.id === state.activeTab;
      })[0];
      return tab ? tab.status : '';
    }

    function renderSummary() {
      var diff = state.diff;
      var cards = [
        ['New non-followers', visible(diff.newNonFollowers).length],
        ['Unfollowed me, I still follow', visible(diff.unfollowedMeStillFollow).length],
        ['Current non-followers', visible(diff.currentNonFollowers).length],
        ['Current followers', diff.counts.currentFollowers],
        ['Current following', diff.counts.currentFollowing]
      ];
      els.summary.innerHTML = '';
      cards.forEach(function (card) {
        var el = document.createElement('div');
        el.className = 'card';
        var value = document.createElement('strong');
        value.textContent = card[1].toLocaleString();
        var label = document.createElement('span');
        label.textContent = card[0];
        el.appendChild(value);
        el.appendChild(label);
        els.summary.appendChild(el);
      });
    }

    function renderTabs() {
      els.tabs.innerHTML = '';
      TABS.forEach(function (tab) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'tab' + (tab.id === state.activeTab ? ' active' : '');
        button.textContent = tab.label;
        button.addEventListener('click', function () {
          state.activeTab = tab.id;
          render();
        });
        els.tabs.appendChild(button);
      });
    }

    function renderLists() {
      els.lists.innerHTML = '';
      currentEntries().forEach(function (group) {
        var usernames = filterAndSort(group.usernames);
        var section = document.createElement('section');
        section.className = 'list-group';
        if (group.label) {
          var heading = document.createElement('h3');
          heading.textContent = group.label + ' (' + usernames.length + ')';
          section.appendChild(heading);
        }
        if (!usernames.length) {
          var empty = document.createElement('p');
          empty.className = 'empty';
          empty.textContent = 'No accounts in this list.';
          section.appendChild(empty);
        } else {
          var ul = document.createElement('ul');
          ul.className = 'accounts';
          usernames.forEach(function (username) {
            ul.appendChild(renderAccount(username));
          });
          section.appendChild(ul);
        }
        els.lists.appendChild(section);
      });
    }

    function renderAccount(username) {
      var li = document.createElement('li');
      var info = document.createElement('div');
      info.className = 'account-info';

      var handle = document.createElement('span');
      handle.className = 'handle';
      handle.textContent = '@' + username;
      info.appendChild(handle);

      var name = displayName(username);
      if (name) {
        var nameEl = document.createElement('span');
        nameEl.className = 'name';
        nameEl.textContent = name;
        info.appendChild(nameEl);
      }

      var status = state.activeTab === 'ignored' ? 'Ignored' : statusFor();
      if (status) {
        var statusEl = document.createElement('span');
        statusEl.className = 'status';
        statusEl.textContent = status;
        info.appendChild(statusEl);
      }

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'ignore-btn';
      var isIgnored = state.ignored.has(username);
      button.textContent = isIgnored ? 'Restore' : 'Ignore';
      button.addEventListener('click', function () {
        if (isIgnored) state.ignored.delete(username);
        else state.ignored.add(username);
        saveIgnored(state.ignored);
        render();
      });

      li.appendChild(info);
      li.appendChild(button);
      return li;
    }

    function render() {
      if (!state.diff) {
        els.results.hidden = state.ignored.size === 0;
        if (!els.results.hidden) {
          state.activeTab = 'ignored';
          els.summary.innerHTML = '';
          renderTabsForIgnoredOnly();
          renderLists();
        }
        return;
      }
      els.results.hidden = false;
      renderSummary();
      renderTabs();
      els.listTitle.textContent = (TABS.filter(function (t) {
        return t.id === state.activeTab;
      })[0] || {}).label || '';
      renderLists();
    }

    function renderTabsForIgnoredOnly() {
      els.tabs.innerHTML = '';
      els.listTitle.textContent = 'Ignored';
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab active';
      button.textContent = 'Ignored';
      els.tabs.appendChild(button);
    }

    function renderDetected(prev, curr) {
      els.detected.innerHTML = '';
      [['Previous export', prev], ['Current export', curr]].forEach(function (pair) {
        var block = document.createElement('div');
        var title = document.createElement('h4');
        title.textContent = pair[0];
        block.appendChild(title);
        var ul = document.createElement('ul');
        pair[1].files.followers.concat(pair[1].files.following).forEach(function (fileName) {
          var li = document.createElement('li');
          li.textContent = '✓ ' + fileName;
          ul.appendChild(li);
        });
        block.appendChild(ul);
        els.detected.appendChild(block);
      });
      els.detected.hidden = false;
    }

    function exportRows() {
      return currentEntries().map(function (group) {
        return { label: group.label, usernames: filterAndSort(group.usernames) };
      });
    }

    function flatUsernames() {
      return exportRows().reduce(function (all, group) {
        return all.concat(group.usernames);
      }, []);
    }

    function download(fileName, mimeType, content) {
      var blob = new Blob([content], { type: mimeType });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    function csvCell(value) {
      return '"' + String(value).replace(/"/g, '""') + '"';
    }

    els.compare.addEventListener('click', function () {
      showError('');
      els.detected.hidden = true;
      var prevFiles = els.prev.files;
      var currFiles = els.curr.files;
      if (!prevFiles || !prevFiles.length || !currFiles || !currFiles.length) {
        showError('Please select both the previous and the current export (ZIP or JSON/HTML files).');
        return;
      }
      els.compare.disabled = true;
      els.compare.textContent = 'Comparing…';
      Promise.all([parseExportFiles(prevFiles), parseExportFiles(currFiles)])
        .then(function (parsed) {
          state.diff = computeDiff(parsed[0], parsed[1]);
          state.activeTab = 'newNonFollowers';
          renderDetected(parsed[0], parsed[1]);
          render();
        })
        .catch(function (err) {
          state.diff = null;
          els.results.hidden = true;
          showError(err && err.message ? err.message : 'Something went wrong while reading the selected files.');
        })
        .finally(function () {
          els.compare.disabled = false;
          els.compare.textContent = 'Compare';
        });
    });

    els.search.addEventListener('input', function () {
      state.query = els.search.value;
      renderLists();
    });

    els.sort.addEventListener('change', function () {
      state.sort = els.sort.value;
      renderLists();
    });

    els.copyBtn.addEventListener('click', function () {
      var text = flatUsernames().map(function (username) {
        return '@' + username;
      }).join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          els.copyBtn.textContent = 'Copied!';
          setTimeout(function () {
            els.copyBtn.textContent = 'Copy usernames';
          }, 1500);
        });
      } else {
        download('usernames.txt', 'text/plain', text);
      }
    });

    els.txtBtn.addEventListener('click', function () {
      var lines = [];
      exportRows().forEach(function (group) {
        if (group.label) lines.push('# ' + group.label);
        group.usernames.forEach(function (username) {
          lines.push('@' + username + (displayName(username) ? ' (' + displayName(username) + ')' : ''));
        });
        lines.push('');
      });
      download('instagram-list-diff.txt', 'text/plain', lines.join('\n'));
    });

    els.csvBtn.addEventListener('click', function () {
      var rows = ['list,username,display_name'];
      exportRows().forEach(function (group) {
        group.usernames.forEach(function (username) {
          rows.push([
            csvCell(group.label || els.listTitle.textContent),
            csvCell(username),
            csvCell(displayName(username))
          ].join(','));
        });
      });
      download('instagram-list-diff.csv', 'text/csv', rows.join('\n'));
    });

    render();
  }

  return {
    normalizeUsername: normalizeUsername,
    computeDiff: computeDiff,
    difference: difference,
    intersection: intersection,
    classifyFile: classifyFile,
    parseJsonList: parseJsonList,
    parseHtmlList: parseHtmlList,
    parseExportZip: parseExportZip,
    parseExportFiles: parseExportFiles,
    initUI: initUI
  };
});
