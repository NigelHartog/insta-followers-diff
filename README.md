# insta-followers-diff

**Instagram List Diff** — a completely free, static web app that compares two Instagram
data-export ZIP files entirely in your browser.

🔒 Your Instagram data is processed entirely in your browser. Nothing is uploaded to a server.
No Instagram login, no API, no backend, no account, no cost.

## What it does

Select your **previous** and your **current** Instagram export ZIP and press **Compare**.

Two main lists:

| List | Exact set logic |
| --- | --- |
| **New Non-Followers** | `(CURRENT FOLLOWING − CURRENT FOLLOWERS) − (PREVIOUS FOLLOWING − PREVIOUS FOLLOWERS)` |
| **Unfollowed Me — I Still Follow** | `(PREVIOUS FOLLOWERS − CURRENT FOLLOWERS) ∩ CURRENT FOLLOWING` |

Extra lists: current non-followers, current mutuals, new followers, people who unfollowed you,
people you unfollowed and people you started following.

Other features:

* Search, sort (A→Z / Z→A) and per-account **Ignore** buttons.
* Ignored usernames are kept in `localStorage`, so they stay hidden on future visits and future
  comparisons. The ZIP files themselves are never stored. Restore them from the **Ignored** tab.
* Copy usernames to the clipboard, or download the visible list as TXT or CSV.
* Shows which files were detected in each export (e.g. `✓ followers_1.json`), and a clear error
  message when an export is not a valid ZIP or contains no followers/following data.

## How to get your Instagram export

1. Instagram → *Settings* → *Accounts Centre* → *Your information and permissions* →
   *Download your information*.
2. Request the information for **Followers and following** in **JSON** (HTML also works).
3. Wait for the e-mail, download the ZIP — do **not** unzip it, the app reads the ZIP directly.
4. Keep an older export around; you need two of them to compare.

## Deploy to GitHub Pages

The repository root already is the finished site (`index.html`, `styles.css`, `app.js`,
`vendor/jszip.min.js`). No build step, no Node.js, no backend.

1. Push this repository to GitHub (this repo: `NigelHartog/insta-followers-diff`).
2. Open the repository on GitHub and go to **Settings → Pages**.
3. Under **Build and deployment → Source** choose **Deploy from a branch**.
4. Select branch **`main`** and folder **`/ (root)`**, then press **Save**.
5. Wait ~1 minute and open `https://<your-username>.github.io/insta-followers-diff/`.

To run it locally instead, open `index.html` in a browser, or serve the folder with any static
file server.

## Repository layout

```
index.html            markup for the app
styles.css            styling (mobile friendly)
app.js                parsing, set logic, ignore list and UI
vendor/jszip.min.js   JSZip 3.10.1, bundled locally so no CDN request is needed
tests/diff.test.js    unit tests for the set logic and the export parser
```

## Tests (development only)

The deployed site needs nothing but a browser. To verify the set logic locally with Node.js:

```bash
npm test
```
