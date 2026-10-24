# Content Security Policy (workspace and admin apps)

The two Vite apps carry a Content Security Policy because the consultation call client loads code and opens connections the rest of the app never needs (NS-CALLS-01, guidelines 11.4, CW-R-55).

## Where the policy lives

| Place | What it does |
| --- | --- |
| `apps/<app>/src/security/content-security-policy.ts` | The policy itself, as a pure function. One file per app (`workspace`, `admin`); keep the two identical. |
| `apps/<app>/vite.config.ts`, plugin `nestself-content-security-policy` | Injects the policy as `<meta http-equiv="Content-Security-Policy">` right after the charset in the built `index.html`, so any static host enforces it. Build only. |
| `apps/<app>/vite.config.ts`, `preview.headers` | Sends the same policy as a response header from `vite preview`, plus `frame-ancestors 'none'`, which a `<meta>` policy cannot carry. |
| `infra/cdk/lib/edge-stack.ts`, `securityHeadersBehavior` | Deployed stages: the CloudFront response-headers policy must send the header form. Not wired yet; copy the header string from `vite preview` (or `contentSecurityPolicy({ delivery: 'header', … })`). |

The dev server (`vite`, `pnpm dev`) sends no policy on purpose: React Refresh injects an inline module script and HMR opens a websocket, neither of which exists in a build. Check a policy change with `pnpm --filter @nestself/workspace build && pnpm --filter @nestself/workspace preview` and the browser console.

## The directives and why

| Directive | Sources | Why |
| --- | --- | --- |
| `default-src` | `'self'` | Everything else is served by the app. |
| `script-src` | `'self' 'wasm-unsafe-eval' blob: https://*.sdkassets.chime.aws 'sha256-…'` | `*.sdkassets.chime.aws` and `blob:` serve the Chime SDK's background blur and Voice Focus workers; `'wasm-unsafe-eval'` compiles their WebAssembly (it does not allow `eval`). The hash is the inline theme bootstrap in `index.html`, computed at build time, so editing that script needs no manual step. No `'unsafe-inline'`. |
| `worker-src`, `child-src` | `'self' blob: https://*.sdkassets.chime.aws` (`child-src`: `'self' blob:`) | The blur and Voice Focus workers; older Safari reads workers from `child-src`. |
| `connect-src` | `'self' https://*.chime.aws wss://*.chime.aws https://*.sdkassets.chime.aws`, plus the `VITE_API_URL` origin and its `wss:` form when the API is on another origin | Chime signalling (WebSocket) and control (HTTPS), the SDK assets, the NestSelf API and its Socket.IO endpoint (`/api/ws`). Same-origin `/api` is covered by `'self'`. Media itself flows over WebRTC, which CSP does not govern. Chime's `EventIngestionUrl` is deliberately absent (D-CW-13). |
| `img-src`, `media-src` | `'self' data: blob:` / `'self' blob:` | Inline icons and local media streams. |
| `style-src` | `'self' 'unsafe-inline'` | Base UI and Motion set inline styles at runtime. Styles cannot run code; scripts stay strict. |
| `font-src` | `'self' data:` | Fonts are bundled (`@nestself/assets`). |
| `object-src`, `base-uri`, `form-action` | `'none'`, `'self'`, `'self'` | Standard hardening. |
| `frame-ancestors` | `'none'` (header only) | The apps are never framed. |

If the policy blocks background blur (for example a stricter proxy in a client company's network), the call client hides the blur toggle instead of failing (CW-R-55b). Client companies that filter outbound traffic need `*.chime.aws` and `*.sdkassets.chime.aws` allowed, as well as UDP for media (CW-R-55 asks for this in the client-company network note and the support runbook).

The unit test next to each policy (`content-security-policy.test.ts`) asserts the Chime entries, the single hashed inline script and the absence of `'unsafe-inline'` and `'unsafe-eval'` in `script-src`.
