# Desktop entry components

Self-contained React components. Import `LoomiIntro` and `LoginScreen` directly;
each imports its own scoped styles. No web landing CSS, server, Electron or Vite
configuration is required. `LoomiFigure` mirrors the canonical `LoomiPet.jsx`
drawing and should be consolidated with it after that component lands.

## Shell integration

Resolve `/api/auth/me` in the shell while the intro plays. Once the intro finishes,
show the existing workspace for a valid session or enable the login screen.
Mount the login screen beneath the intro for the shared-element handoff, as in
`preview.jsx`. Keep its wrapper `inert` and `aria-hidden` during the intro; this
also hides its resting Loomi so there is only one visible character. Remove the
wrapper attributes on `onDone`. Preserve the full-window layout and initial
login mode for the matching handoff position.

```jsx
<div inert={intro || undefined} aria-hidden={intro || undefined}>
  <LoginScreen
    onSubmit={async ({ mode, email, password, name }) => {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, ...(mode === 'register' ? { name } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '登录失败。');
      // Update shell session state, but keep LoginScreen mounted until onSuccess.
      setUser(result.user);
    }}
    onSuccess={enterWorkspace}
  />
</div>
{intro && <LoomiIntro onDone={() => setIntro(false)} />}
```

`onSubmit` must resolve only after authentication succeeds and throw an `Error`
with the user-facing message on failure. The component locks duplicate requests,
shows rejection messages verbatim, then calls `onSuccess` once after its 750ms
success reaction (150ms with reduced motion). It does not call auth endpoints,
store credentials or own session/workspace navigation.

The intro lasts 7100ms, or a static 400ms fade with reduced motion. Click, Escape, Enter,
Space and the skip button finish it. `sessionStorage` key
`resume-protocol:desktop-intro-played` suppresses another intro in the same window
session; storage denial is harmless. The parent should unmount it on `onDone`.
Both screens reserve a fixed 40px native drag region. Controls are `no-drag`.

Desktop entry defaults to dark, regardless of OS preference: background `#121211`,
surface `#1c1c1a`, ink `#f1eee6`, muted `#a6a398`, line `#3a3935`. Only
`<html data-theme="light">` selects the original light palette. Loomi uses the
same ink/surface tokens automatically; no external fonts or assets load.
`introTimeline.js` exports the pure, seekable `introFrame(time, layout)` and
controls phase boundaries. `loginState.js` mirrors the
current server validation contract. Server validation remains authoritative.

## Launch choreography

The approved reference is `tmp/loomi-intro-spec.dc.html`. Its prototype time
maps from real elapsed time as `t = real < 500 ? real : real + 500`.
Every pose uses the existing `LoomiFigure`; the prototype's character drawing
is not copied. One `requestAnimationFrame` loop writes transforms, opacity and
SVG attributes through refs, without React state updates on each frame.

| Real elapsed ms | Motion |
| --- | --- |
| 0–500 | Large bottom-right peek, gentle bob, one blink at 200–290ms |
| 500–1550 | Immediate ease-out pull-back, fading bob, landing squash and shadow |
| 1550–2750 | Tuck, exactly two full rolls, untuck upright |
| 2750–3400 | Shoot silk to the top, then climb to the card |
| 3400–5200 | Trace only the measured 20px rounded card border |
| 5200–7100 | Hop to the measured resting pet; draw eight spokes, then three rings; wave |

The continuous camera follows the prototype zoom curve and clamps to the
viewport. It transforms only the silk/traveler stage, never the real login.
It returns to scale 1 at real 5600ms. The reference starts revealing its painted
card sooner; here the real card begins its staggered reveal at 5600ms, after
the camera resets, so the border aligns throughout the reveal. Heading, email,
password and button then fade and slide in separately.

At mount, window resize and element resize, the intro measures `.login-card`,
`.login-loomi` and `.login-corner-web`. Border geometry is cached per layout;
there are no per-frame layout reads. The small web shares its eleven path
definitions with LoginScreen. The final pet position and SVG size match the
resting figure. Skip/completion/unmount restore every borrowed login style;
the parent still owns the `inert`/`aria-hidden` handoff.

## Preview and verification

```sh
npm run dev -- --port 5178
# On Windows with PowerShell script execution disabled, use npm.cmd instead.
# http://127.0.0.1:5178/desktop-preview.html
# Add ?skipIntro=1 or ?theme=light (or combine with &).
node scripts/test-desktop-login.mjs
node --test src/desktop/introTimeline.test.js src/desktop/loginState.test.js
```

The fake submit waits 900ms and rejects password `wrongpassword1`; all other
valid inputs resolve. Preview leaves the success reaction on screen after its
callback so it can be inspected. Clear the sessionStorage key or open a new
browser context to replay the intro. The root preview HTML is dev-only and is
not a production build entry.

The browser script uses local Chrome/Edge through `playwright-core`. Override
`DESKTOP_TEST_BROWSER` or `DESKTOP_PREVIEW_URL` if needed. It checks keyboard
skipping/submission, cover/peek, Caps Lock, error/retry/success, registration
validation, sessionStorage denial, reduced motion, default dark/light override and
viewport overflow. Intro screenshots advance the production rAF loop with the
Playwright clock. Checks also cover blink/tuck, border alignment, camera reset,
pet/web handoff, inert cleanup and a resize to 390px during the intro. Browser checks
also verify a reduced-motion preference change while the camera is zoomed. Unit tests
sample every 8ms and immediately around phase boundaries at multiple viewport
sizes to catch position, scale, rotation, tuck, squash and camera jumps. Screenshots and the full
check manifest are in `output/desktop-login/`.

Captured screenshots:

- `intro-{240,1000,2200,3000,4000,5500,6000,6800,7050}ms-1920x1080.png`
- `intro-resized-6000ms-390x844.png`
- `intro-reduced-motion-dark.png`
- `login-idle-{light,dark}-{960x640,1920x1080,2560x1440}.png`
- `login-register-light-960x640.png`
- `login-password-{covered,peek}-1920x1080.png`
- `login-{submitting,error,success}-1920x1080.png`

Verify with the targeted unit command above, `npm run build`, and the browser
script (23 screenshots). The production build excludes this dev-only preview;
the browser script exercises the desktop components through Vite directly. Actual Electron
session routing, frameless window dragging, a physical 60fps display and spoken
screen-reader output require shell/device verification after integration.
