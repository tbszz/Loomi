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

The intro lasts 3300ms, or 400ms with reduced motion. Click, Escape, Enter,
Space and the skip button finish it. `sessionStorage` key
`resume-protocol:desktop-intro-played` suppresses another intro in the same window
session; storage denial is harmless. The parent should unmount it on `onDone`.
Both screens reserve a fixed 40px native drag region. Controls are `no-drag`.

Theme follows `<html data-theme="light|dark">`, otherwise the OS preference.
The scoped palette mirrors `workspace.css`; no external fonts or assets load.
`introTimeline.js` controls phase boundaries and `loginState.js` mirrors the
current server validation contract. Server validation remains authoritative.

## Preview and verification

```sh
npm run dev -- --port 5178
# http://127.0.0.1:5178/desktop-preview.html
# Add ?skipIntro=1 or ?theme=dark (or combine with &).
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
validation, sessionStorage denial, reduced motion, theme preference/override and
viewport overflow. Intro screenshots freeze CSS animations at exact times and
advance component timers with the Playwright clock. Screenshots and the full
check manifest are in `output/desktop-login/`.

Captured screenshots:

- `intro-{0.3,1.0,1.7,2.4,3.2}s-1920x1080.png`
- `intro-reduced-motion-dark.png`
- `login-idle-{light,dark}-{960x640,1920x1080,2560x1440}.png`
- `login-register-light-960x640.png`
- `login-password-{covered,peek}-1920x1080.png`
- `login-{submitting,error,success}-1920x1080.png`

Verified with `npm test`, `npm run build`, and the browser script. Actual Electron
session routing, frameless window dragging, a physical 60fps display and spoken
screen-reader output require shell/device verification after integration.
