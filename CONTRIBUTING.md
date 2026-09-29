# Contributing

Every change reaches the live site through the same path: a pull request, an automatic check, a
merge. A change whose check is red is never published; the site stays at the last green build.

## Changing text, names or numbers

Most edits are in `content/` and can be made in the GitHub web interface.

1. Open the file, for example `content/copy.en.yaml` (every visible sentence lives there), and
   choose **Edit**.
2. Make the change. Keep fields in braces, such as `{amount}`, as they are. Do not write clock times;
   the app formats them.
3. Choose **Commit changes…**, select **Create a new branch … and start a pull request**, and
   describe the change in one line.
4. Wait for the checks on the pull request; the one that decides is **gate**.
   - Green: merge the pull request. The site updates a few minutes later.
   - Red: open the check, read the first error (it names the file and line), fix it on the same
     branch and wait again.

Uploading an `index.html` at the top of the repository does not change the site. The current
public page lives in `legacy/`; the app is built from `src/` and `content/`.

## Wording rules

The check `node scripts/check-banned.ts` fails when content, Markdown or source files contain
wording the product must not use. In short:

- No claims about pegs, stable value, gains, rates on balances, token sales, anonymity,
  regulatory status or custody. Use the approved phrases already in `content/copy.en.yaml`
  exactly as written.
- Visible text describes the product as it works and follows decision D16; `check-banned`
  lists the words it rejects.
- No personal contact details (email addresses, phone numbers) and no business figures. Login
  emails in `content/personas.yaml` use reserved domains (`example.com`, `*.example`) only; the
  screens show them with the domain masked ("ana.novak@•••••••"), and the check fails on any
  readable email address in rendered text.
- Every amount, fee, rate or timing shown on screen comes from `content/` (the stored values);
  `node scripts/check-content.ts` checks those files and their arithmetic.

If the check flags a sentence you need, rephrase it. Approved exceptions are exact sentences in
`scripts/banned-core.ts` (`ALLOWLIST`); adding one needs a recorded product decision.

## Commit identity

Commits made on a computer must use the approved commit identity of this repository; ask the
repository owner for it. Set it inside your clone only:

```sh
git config user.name  "<approved name>"
git config user.email "<approved email>"
git config user.email   # check it before every commit
```

Never use `--global` for this. The check `scripts/check-commit-identity.sh` rejects new commits
whose author or committer email is not on the repository's allowlist. A rejected commit is already
public once pushed, so check your identity before committing.

## Working on the code

See [README.md](README.md) for the commands. Before opening a pull request, run every CI job
locally (the same commands as `.github/workflows/pages.yml`):

```sh
npm run ci          # static, unit, build, e2e and visual, then the gate
npm run ci:static   # or one job at a time: ci:static, ci:unit, ci:build, ci:e2e, ci:visual
```

Rules for code:

- Money is always an integer number of hundredths. `src/domain/` never uses `Date`,
  `Math.random` or the DOM.
- All visible strings come from `content/copy.en.yaml`.
- The end-to-end tests rely on these attributes, so keep them stable:
  - `data-phone="<persona>"` on each phone's root element;
  - `data-testid="balance-<personaId>"` around each balance amount;
  - `data-testid="not-found"` on the not-found page;
  - `data-slot="left|right|single"` and `data-persona="<id>"` (`none` on Welcome) on each phone, and
    `data-screen="<id>"` on the root of every screen inside it;
  - `window.__bcps` (`advance`, `now`, `dispatch`), present only with `?clock=manual`: the end-to-end
    tests move the virtual clock and send a command through it.
- Never put passwords, tokens or keys in the repository or in workflows. The deployment uses only
  the built-in `GITHUB_TOKEN`.
