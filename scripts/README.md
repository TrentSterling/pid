# Tutorial build

`tutorial/tutorial.md` is the complete tutorial source. The generated
`tutorial/index.html` is committed, so GitHub Pages serves the tutorial without
a build server or browser-side Markdown library. `tutorial/styles.css` is the
hand-written stylesheet.

Use Node.js 20 or newer and the pinned build dependency:

```sh
npm install --prefix scripts --ignore-scripts
node scripts/build-tutorial.mjs
```

Check that the committed output is current without rewriting it:

```sh
node scripts/build-tutorial.mjs --check
```

The builder uses `marked` **17.0.5** with GitHub-flavored Markdown and creates
stable heading IDs, the table of contents, accessible table wrappers, and
optional copy-code controls. The page keeps working without JavaScript; the
small inline script adds copy buttons, the current-section highlight, and a
reading-progress indicator. No fonts, scripts, or styles load from a CDN.

For the ChatGPT workspace, the builder can also resolve the same pinned package
from `CODEX_PRIMARY_RUNTIME_NODE_MODULES`. It rejects a different version. This
fallback does not affect the generated HTML or ordinary local builds.

After editing the Markdown or builder, regenerate `index.html` and commit both
the source and generated output. Deploy the branch before doing visual browser
review, following this project's requested review order.

## Other deliverables

The Unity kit is packaged separately, using Python's standard library:

```sh
python scripts/package-unity.py
```

This creates the deterministic `downloads/TrontPhysicsGym-Unity.zip` archive.
Rebuild it after changing the Unity scripts, tutorial, or included notices.

The repository's source and packaging checks are collected in
`scripts/validate-deliverables.py`. These checks do not replace Unity compilation,
in-headset testing, or browser visual review after deployment.
