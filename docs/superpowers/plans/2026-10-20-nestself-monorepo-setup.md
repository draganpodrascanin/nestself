# NestSelf Monorepo Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the NestSelf pnpm + Turborepo monorepo: five apps (marketing, workspace, admin, mobile, api), ten shared packages, the handoff design system as framework-independent tokens, i18n in `en`, `sr-Latn` and `sr-Cyrl`, and the checks the handoff requires, with no product features, no fake backend and no real transactions.

**Architecture:** Workspace packages export TypeScript source and each app's bundler compiles them (no `dist`). Tokens flow `tokens.json` → `tokens.css` (CSS custom properties, 4 palettes × 2 modes) → `tailwind.css` (`@theme inline` bridge) → Base UI components in `@nestself/ui`; and `tokens.json` → typed native theme → React Native primitives in `@nestself/ui-native`. One `pnpm install` happens in Phase 0; every later task only writes files.

**Tech Stack:** pnpm 10.10.0, Turborepo 2.11.9, TypeScript 5.9.3, React 19.3.1, Next.js 16.4.2, Vite 8.3.4, TanStack Router 1.170.45 / Query 5.104.5, Tailwind 4.3.3, @base-ui/react 1.9.0, @phosphor-icons/react 2.1.10, Storybook 10.6.3, Vitest 5.0.5 (jsdom), Playwright 1.64.1 + axe, Expo SDK 58 (react-native 0.88.0, expo-router 58), NestJS 12.2.0, Prisma 7.10.1 + @prisma/adapter-pg, i18next 26.5.3 / react-i18next 17.1.0, zod 4.6.7, sharp 0.35.5, ESLint 9.39.5 flat config, Prettier 3.9.10.

Spec: `docs/superpowers/specs/2026-10-20-nestself-monorepo-setup-design.md`. Research that produced the versions and gotchas: workflow run `wf_49feb72b-102` (journal under the session's `subagents/workflows` directory).

---

## How to execute this plan

- **Phase 0 is sequential** (one worker). **Phases 1, 2a, 2b and 3 contain independent tasks** that run in parallel, each in its own directory. **Phase 4 is sequential.**
- **After Phase 0 no worker runs `pnpm install`, `pnpm add`, `pnpm dlx`, `npx`, `expo install`, `nest new`, `create-*`, `storybook init`, or anything else that touches `pnpm-lock.yaml` or `node_modules`.** Every dependency is declared in Task 0.4. If a task needs something missing, finish everything else and list it under "Missing dependencies" in the task report; the orchestrator adds it at the next barrier.
- Workers do not run `git add`/`git commit`; the orchestrator commits at each barrier.
- Design source of truth: `docs/design-handoff/`. Read `CLAUDE.md`, `styles/tokens.css`, the relevant part of `styles/styles.css`, `index.html` and `scripts/app.js` there before building a component or screen. The CSS there is the contract; translate it to Tailwind utilities that resolve to the same semantic variables.
- **Colour rule:** component and app code reference semantic tokens only (`bg-primary`, `text-text-secondary`, `border-border-control`, `var(--color-focus)`). No hex literal anywhere outside `packages/tokens/tokens.css`, `packages/tokens/tokens.json` and the smoke test. The token smoke check scans `packages/ui/src`, `packages/ui-native/src` and `apps/*/src` and fails otherwise.
- **Content rule:** no testimonials, client logos, invented statistics, availability promises, privacy guarantees, fake bookings, payments or messages. Interactive demonstrations say that nothing was created. Stock people are never named experts or customers. Sample data is flagged and banner-labelled.
- **Done rule for every task:** `pnpm --filter <package> lint`, `pnpm --filter <package> typecheck` and `pnpm --filter <package> test` pass, and the task report lists files created, commands run with their output summary, deviations from this plan, missing dependencies, and unimplemented states.
- Ports: marketing 3000, workspace 5173, admin 5174, api 4000, storybook 6006, metro 8081.
- Scratch files go in the session scratchpad, never in the repo.

## Final file structure

```
Nestself/
├─ apps/
│  ├─ marketing/   Next.js 16 App Router, [locale] routes, i18next, image-led home
│  ├─ workspace/   Vite SPA, TanStack Router file routes, employee/manager/HR layouts
│  ├─ admin/       Vite SPA, TanStack Router, NestSelf back office
│  ├─ mobile/      Expo Router app, tabs Home/Support/Appointments/Messages
│  └─ api/         NestJS 12, Prisma 7 schema skeleton, health + roles example
├─ packages/
│  ├─ typescript-config/  base, vite-react, nextjs, nestjs, react-native tsconfig presets
│  ├─ eslint-config/      base, react, react-native, next, node flat configs
│  ├─ tokens/             tokens.json, tokens.css, tailwind.css, src/{index,native,theme}.ts, smoke test
│  ├─ assets/             fonts (woff2 + ttf + OFL), photos + photos.json, Phosphor SVG subset, image scripts
│  ├─ ui/                 React web components on Base UI + Tailwind, Storybook, tests
│  ├─ ui-native/          React Native primitives + ThemeProvider
│  ├─ i18n/               locale config, catalogs, transliteration, parity check, Intl helpers
│  ├─ contracts/          zod schemas: roles, locales, support areas, health, access model
│  ├─ api-client/         typed fetch wrapper + TanStack Query options
│  └─ sample-data/        flagged fictional fixtures + sample-mode helpers
├─ e2e/                   Playwright specs + tsconfig
├─ docker/docker-compose.yml
├─ docs/design-handoff/   the handoff package, unchanged
├─ docs/superpowers/{specs,plans}/
├─ package.json  pnpm-workspace.yaml  turbo.json  .npmrc  .nvmrc  .editorconfig
├─ .prettierrc.mjs  .prettierignore  .gitignore  .env.example  playwright.config.ts
└─ README.md  CLAUDE.md  CREDITS.md
```

---

## Phase 0 — Foundation (sequential, one worker)

### Task 0.1: Move the handoff into docs and write the root files

**Files:**
- Move: `NestSelf_Web_Handoff/` → `docs/design-handoff/`
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `.nvmrc`, `.editorconfig`, `.prettierrc.mjs`, `.prettierignore`, `.env.example`, `docker/docker-compose.yml`
- Modify: `.gitignore`

- [ ] **Step 1: Move the handoff (it is untracked, so a plain move is fine)**

```bash
cd /Users/draganpodrascanin/Desktop/projects/Nestself
mv NestSelf_Web_Handoff docs/design-handoff
test -f docs/design-handoff/index.html && echo moved
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "nestself",
  "private": true,
  "packageManager": "pnpm@10.10.0",
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "check": "turbo run check",
    "verify": "pnpm lint && pnpm typecheck && pnpm test && pnpm check && pnpm build",
    "e2e": "playwright test",
    "e2e:update": "playwright test --update-snapshots",
    "storybook": "pnpm --filter @nestself/ui dev",
    "images:build": "pnpm --filter @nestself/assets build",
    "credits": "node packages/assets/scripts/build-credits.mjs",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "check:deps": "sherif",
    "db:up": "docker compose -f docker/docker-compose.yml up -d",
    "db:down": "docker compose -f docker/docker-compose.yml down"
  },
  "devDependencies": {
    "@axe-core/playwright": "catalog:",
    "@playwright/test": "catalog:",
    "@types/node": "catalog:",
    "prettier": "catalog:",
    "prettier-plugin-tailwindcss": "catalog:",
    "sherif": "catalog:",
    "turbo": "catalog:",
    "typescript": "catalog:"
  },
  "pnpm": {
    "overrides": {
      "react": "19.3.1",
      "react-dom": "19.3.1"
    }
  }
}
```

- [ ] **Step 3: Write `pnpm-workspace.yaml`** (the single place where versions are pinned; every workspace uses `catalog:`)

```yaml
packages:
  - "apps/*"
  - "packages/*"

catalog:
  # React (web and native must agree; react-native 0.88 requires ^19.3.0)
  react: 19.3.1
  react-dom: 19.3.1
  "@types/react": 19.3.0
  "@types/react-dom": 19.3.0
  # TypeScript and Node (5.9.x: typescript-eslint supports <6.1, @nestjs/swagger ^5.5||^6)
  typescript: 5.9.3
  "@types/node": 24.19.2
  tsx: 4.23.15
  # Bundlers and CSS
  vite: 8.3.4
  "@vitejs/plugin-react-swc": 4.3.3
  next: 16.4.2
  postcss: 8.5.31
  tailwindcss: 4.3.3
  "@tailwindcss/vite": 4.3.3
  "@tailwindcss/postcss": 4.3.3
  # TanStack
  "@tanstack/react-router": 1.170.45
  "@tanstack/router-plugin": 1.168.47
  "@tanstack/react-router-devtools": 1.167.2
  "@tanstack/react-query": 5.104.5
  "@tanstack/react-query-devtools": 5.104.5
  # UI
  "@base-ui/react": 1.9.0
  "@phosphor-icons/react": 2.1.10
  clsx: 2.1.1
  tailwind-merge: 3.7.0
  # i18n
  i18next: 26.5.3
  react-i18next: 17.1.0
  i18next-browser-languagedetector: 8.2.1
  # Validation
  zod: 4.6.7
  # Testing
  vitest: 5.0.5
  jsdom: 30.1.3
  "@testing-library/react": 16.3.3
  "@testing-library/dom": 10.4.2
  "@testing-library/jest-dom": 7.0.1
  "@testing-library/user-event": 14.6.8
  axe-core: 4.14.0
  "@playwright/test": 1.64.1
  "@axe-core/playwright": 4.14.0
  supertest: 7.3.1
  "@types/supertest": 7.2.1
  # Storybook
  storybook: 10.6.3
  "@storybook/react-vite": 10.6.3
  "@storybook/addon-a11y": 10.6.3
  # Lint and format (ESLint 9: jsx-a11y and react-refresh do not support 10 yet)
  eslint: 9.39.5
  "@eslint/js": 9.39.5
  typescript-eslint: 8.72.0
  eslint-config-next: 16.4.2
  eslint-config-prettier: 10.1.8
  eslint-plugin-jsx-a11y: 6.10.2
  eslint-plugin-react-hooks: 7.1.1
  eslint-plugin-react-refresh: 0.5.7
  globals: 17.13.0
  prettier: 3.9.10
  prettier-plugin-tailwindcss: 0.8.1
  # Images
  sharp: 0.35.5
  # Expo SDK 58 / React Native
  expo: 58.0.16
  expo-router: 58.0.24
  expo-font: 58.0.9
  expo-image: 58.0.16
  expo-localization: 58.0.5
  expo-status-bar: 58.0.3
  expo-splash-screen: 58.0.10
  expo-system-ui: 58.0.6
  expo-constants: 58.0.12
  expo-linking: 58.0.13
  babel-preset-expo: 58.0.18
  react-native: 0.88.0
  react-native-screens: 4.30.0
  react-native-safe-area-context: 5.10.1
  react-native-svg: 15.16.0
  phosphor-react-native: 3.0.6
  "@react-native-async-storage/async-storage": 3.1.1
  # NestJS and Prisma (prisma `latest` is an 8.0 RC; 7.10.1 is the stable line)
  "@nestjs/common": 12.2.0
  "@nestjs/core": 12.2.0
  "@nestjs/platform-express": 12.2.0
  "@nestjs/cli": 12.0.9
  "@nestjs/config": 12.0.1
  "@nestjs/swagger": 12.0.2
  "@nestjs/terminus": 12.1.0
  "@nestjs/throttler": 6.7.1
  "@nestjs/jwt": 12.0.3
  "@nestjs/testing": 12.2.0
  nestjs-pino: 5.3.1
  pino: 10.4.0
  pino-http: 11.0.0
  pino-pretty: 13.2.0
  prisma: 7.10.1
  "@prisma/client": 7.10.1
  "@prisma/adapter-pg": 7.10.1
  pg: 8.23.1
  "@types/pg": 8.23.1
  rxjs: 7.8.2
  reflect-metadata: 0.2.2
  helmet: 8.3.0
  dotenv: 18.0.8
  "@swc/core": 1.16.18
  "@swc/helpers": 0.5.23
  unplugin-swc: 2.0.0
  # Repo tooling
  turbo: 2.11.9
  sherif: 1.13.0

# pnpm 10 blocks dependency build scripts unless allow-listed.
onlyBuiltDependencies:
  - "@prisma/engines"
  - "@prisma/client"
  - prisma
  - "@swc/core"
  - esbuild
  - unrs-resolver
  - "@parcel/watcher"
  - core-js
  - sharp
```

- [ ] **Step 4: Write `turbo.json`**

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "ui": "tui",
  "globalDependencies": ["pnpm-workspace.yaml", ".npmrc", "packages/typescript-config/*.json"],
  "tasks": {
    "topo": { "dependsOn": ["^topo"] },
    "build": {
      "dependsOn": ["^build", "images:sync"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"],
      "env": ["NODE_ENV", "VITE_*", "NEXT_PUBLIC_*", "EXPO_PUBLIC_*"]
    },
    "dev": { "persistent": true, "cache": false, "dependsOn": ["images:sync"] },
    "lint": { "dependsOn": ["topo"] },
    "typecheck": { "dependsOn": ["topo"] },
    "test": { "dependsOn": ["topo"], "env": ["CI"] },
    "check": { "dependsOn": ["topo"] },
    "storybook:build": { "dependsOn": ["topo"], "outputs": ["storybook-static/**"] },
    "@nestself/assets#build": {
      "dependsOn": [],
      "inputs": ["photos/**", "photos.json", "scripts/build-images.mjs"],
      "outputs": ["dist/**"]
    },
    "images:sync": {
      "dependsOn": ["@nestself/assets#build"],
      "outputs": ["public/images/**"]
    },
    "prisma:generate": {
      "inputs": ["prisma/schema.prisma", "prisma.config.ts"],
      "outputs": ["src/generated/**"]
    },
    "@nestself/api#build": { "dependsOn": ["@nestself/api#prisma:generate", "^build"], "outputs": ["dist/**"] },
    "@nestself/api#typecheck": { "dependsOn": ["@nestself/api#prisma:generate", "topo"] },
    "@nestself/api#test": { "dependsOn": ["@nestself/api#prisma:generate", "topo"] },
    "@nestself/api#dev": { "dependsOn": ["@nestself/api#prisma:generate"], "persistent": true, "cache": false }
  }
}
```

`topo` is a transit task: `lint`, `typecheck`, `test` and `check` depend on it so they run in parallel across packages while cache keys still follow the dependency graph.

- [ ] **Step 5: Write `.npmrc`, `.nvmrc`, `.editorconfig`, `.prettierrc.mjs`, `.prettierignore`**

`.npmrc`:
```ini
# pnpm 10 defaults: isolated node-linker, auto-install-peers. Expo SDK 58 works with isolated installs.
# If Metro cannot resolve a workspace package, uncomment the next line as a last resort.
# node-linker=hoisted
```

`.nvmrc`:
```
24
```

`.editorconfig`:
```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

`.prettierrc.mjs`:
```js
/** @type {import('prettier').Config} */
export default {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindStylesheet: './packages/ui/src/styles.css',
  tailwindFunctions: ['cn', 'cva'],
};
```

`.prettierignore`:
```
node_modules
dist
build
.next
.turbo
.expo
coverage
storybook-static
pnpm-lock.yaml
routeTree.gen.ts
**/src/generated/**
docs/design-handoff
public/images
packages/assets/dist
e2e/__screenshots__
e2e/test-results
e2e/playwright-report
```

- [ ] **Step 6: Replace `.gitignore`**

```gitignore
# dependencies
node_modules/
.pnpm-store/

# build outputs
dist/
build/
.next/
out/
.turbo/
storybook-static/
coverage/
*.tsbuildinfo

# generated
apps/api/src/generated/
apps/api/openapi.json
packages/assets/dist/
apps/*/public/images/

# expo / native
.expo/
.expo-shared/
apps/mobile/ios/
apps/mobile/android/
*.jks
*.p8
*.p12
*.key
*.mobileprovision

# env and local
.env
.env.*
!.env.example
.DS_Store
*.log
.vscode/*
!.vscode/extensions.json
.idea/

# playwright
e2e/test-results/
e2e/playwright-report/

# design deliverables kept out of git (the extracted package lives in docs/design-handoff)
NestSelf_Web_Handoff.zip
NestSelf_Design_System.html
```

- [ ] **Step 7: Write `.env.example` (root, documentation of every variable)**

```ini
# ---- apps/api (copy to apps/api/.env) ----
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://nestself:nestself_dev@localhost:5432/nestself
JWT_SECRET=change-me-to-at-least-32-characters-long-please
JWT_EXPIRES_IN=1h
MARKETING_URL=http://localhost:3000
WORKSPACE_URL=http://localhost:5173
ADMIN_URL=http://localhost:5174

# ---- apps/workspace and apps/admin (copy to apps/<app>/.env.local) ----
VITE_API_URL=http://localhost:4000
VITE_DATA_SOURCE=sample            # sample | api  (sample renders fixtures and the sample banner)

# ---- apps/mobile (copy to apps/mobile/.env.local) ----
EXPO_PUBLIC_API_URL=http://localhost:4000
EXPO_PUBLIC_DATA_SOURCE=sample

# ---- apps/marketing ----
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

- [ ] **Step 8: Write `docker/docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: nestself
      POSTGRES_PASSWORD: nestself_dev
      POSTGRES_DB: nestself
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nestself -d nestself"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

- [ ] **Step 9: Verify the JSON/YAML parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); JSON.parse(require('fs').readFileSync('turbo.json','utf8')); console.log('ok')"`
Expected: `ok`

### Task 0.2: `packages/typescript-config`

**Files:** `packages/typescript-config/{package.json,base.json,vite-react.json,nextjs.json,nestjs.json,react-native.json}`

- [ ] **Step 1: Write the files**

`package.json`:
```json
{
  "name": "@nestself/typescript-config",
  "version": "0.0.0",
  "private": true,
  "license": "UNLICENSED",
  "exports": {
    "./base.json": "./base.json",
    "./vite-react.json": "./vite-react.json",
    "./nextjs.json": "./nextjs.json",
    "./nestjs.json": "./nestjs.json",
    "./react-native.json": "./react-native.json"
  }
}
```

`base.json`:
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "moduleDetection": "force",
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": []
  },
  "exclude": ["node_modules", "dist", "build"]
}
```

`vite-react.json`:
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"]
  }
}
```

`nextjs.json`:
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "allowJs": true,
    "incremental": true,
    "types": ["node"],
    "plugins": [{ "name": "next" }]
  }
}
```

`nestjs.json`:
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "verbatimModuleSyntax": false,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "noEmit": false,
    "declaration": false,
    "sourceMap": true,
    "incremental": true,
    "types": ["node"]
  }
}
```

`react-native.json`:
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "jsx": "react-jsx"
  }
}
```

### Task 0.3: `packages/eslint-config`

**Files:** `packages/eslint-config/{package.json,base.js,react.js,react-native.js,next.js,node.js}`

- [ ] **Step 1: Write the files**

`package.json`:
```json
{
  "name": "@nestself/eslint-config",
  "version": "0.0.0",
  "private": true,
  "license": "UNLICENSED",
  "type": "module",
  "exports": {
    "./base": "./base.js",
    "./react": "./react.js",
    "./react-native": "./react-native.js",
    "./next": "./next.js",
    "./node": "./node.js"
  },
  "dependencies": {
    "@eslint/js": "catalog:",
    "eslint-config-next": "catalog:",
    "eslint-config-prettier": "catalog:",
    "eslint-plugin-jsx-a11y": "catalog:",
    "eslint-plugin-react-hooks": "catalog:",
    "eslint-plugin-react-refresh": "catalog:",
    "globals": "catalog:",
    "typescript-eslint": "catalog:"
  },
  "peerDependencies": {
    "eslint": "^9.39.0",
    "typescript": ">=5.0.0 <6.1.0"
  }
}
```

`base.js`:
```js
// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier/flat';

/** @type {import('eslint').Linter.Config[]} */
export const base = [
  {
    name: 'nestself/ignores',
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/out/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/storybook-static/**',
      '**/*.gen.ts',
      '**/src/generated/**',
      '**/public/**',
    ],
  },
  { name: 'eslint/recommended', ...eslint.configs.recommended },
  ...tseslint.configs.recommended,
  { name: 'prettier', ...prettier },
  {
    name: 'nestself/rules',
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
];
```

`react.js`:
```js
// @ts-check
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import { base } from './base.js';

/** @type {import('eslint').Linter.Config[]} */
export const react = [
  ...base,
  reactHooks.configs['recommended-latest'],
  jsxA11y.flatConfigs.recommended,
  {
    name: 'nestself/react',
    plugins: { 'react-refresh': reactRefresh },
    languageOptions: { globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: '19' } },
    rules: { 'react-refresh/only-export-components': ['warn', { allowConstantExport: true }] },
  },
];
```

`react-native.js`:
```js
// @ts-check
import reactHooks from 'eslint-plugin-react-hooks';
import { base } from './base.js';

/** @type {import('eslint').Linter.Config[]} */
export const reactNative = [
  ...base,
  reactHooks.configs['recommended-latest'],
  {
    name: 'nestself/react-native',
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: '19' } },
  },
];
```

`next.js`:
```js
// @ts-check
import nextConfig from 'eslint-config-next';
import prettier from 'eslint-config-prettier/flat';

/** @type {import('eslint').Linter.Config[]} */
export const next = [
  { name: 'nestself/ignores', ignores: ['**/.next/**', '**/out/**', '**/public/**', '**/node_modules/**'] },
  ...nextConfig,
  { name: 'prettier', ...prettier },
  {
    name: 'nestself/next-rules',
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
    },
  },
];
```

`node.js`:
```js
// @ts-check
import globals from 'globals';
import { base } from './base.js';

/** @type {import('eslint').Linter.Config[]} */
export const node = [
  ...base,
  { name: 'nestself/node', languageOptions: { globals: globals.node }, rules: { 'no-console': 'off' } },
];
```

Per-workspace `eslint.config.js` is always one line, for example `export { react as default } from '@nestself/eslint-config/react';`.

### Task 0.4: Manifests and stubs for every workspace

Create every package and app directory with `package.json`, `tsconfig.json`, `eslint.config.js` and a stub entry so the whole graph installs and typechecks before any real code exists. Later tasks overwrite the stubs; they must not change dependency lists.

**Files:** listed per workspace below.

- [ ] **Step 1: `packages/tokens`**

`package.json`:
```json
{
  "name": "@nestself/tokens",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./native": "./src/native.ts",
    "./theme": "./src/theme.ts",
    "./tokens.css": "./tokens.css",
    "./tailwind.css": "./tailwind.css",
    "./tokens.json": "./tokens.json"
  },
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check": "vitest run src/smoke.test.ts"
  },
  "devDependencies": {
    "@nestself/eslint-config": "workspace:*",
    "@nestself/typescript-config": "workspace:*",
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "jsdom": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```
`tsconfig.json`: `{ "extends": "@nestself/typescript-config/base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "tokens.json"] }`
`eslint.config.js`: `export { base as default } from '@nestself/eslint-config/base';`
`vitest.config.ts`: `import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] } });`
`src/index.ts`: `export {};` · `src/native.ts`: `export {};` · `src/theme.ts`: `export {};` · `tokens.json`: `{}` placeholder · `tokens.css` and `tailwind.css`: empty files.

- [ ] **Step 2: `packages/assets`**

`package.json`:
```json
{
  "name": "@nestself/assets",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./fonts.css": "./fonts/fonts.css",
    "./fonts/*": "./fonts/*",
    "./photos/*": "./photos/*",
    "./photos.json": "./photos.json",
    "./icons/*": "./icons/*"
  },
  "scripts": {
    "build": "node scripts/build-images.mjs",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@nestself/eslint-config": "workspace:*",
    "@nestself/typescript-config": "workspace:*",
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "sharp": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```
`tsconfig.json`: `{ "extends": "@nestself/typescript-config/base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "photos.json"] }`
`eslint.config.js`: `export { node as default } from '@nestself/eslint-config/node';`
`vitest.config.ts`: node environment, include `src/**/*.test.ts`.
Stubs: `src/index.ts` (`export {};`), `photos.json` (`[]`), `fonts/fonts.css` (empty), `scripts/build-images.mjs` (`console.log('stub')`).

- [ ] **Step 3: `packages/contracts`**

`package.json`:
```json
{
  "name": "@nestself/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "lint": "eslint .", "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "zod": "catalog:" },
  "devDependencies": {
    "@nestself/eslint-config": "workspace:*",
    "@nestself/typescript-config": "workspace:*",
    "eslint": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```
`tsconfig.json`: extends base, include `src`. `eslint.config.js`: base. `vitest.config.ts`: node. `src/index.ts`: `export {};`

- [ ] **Step 4: `packages/i18n`**

`package.json`:
```json
{
  "name": "@nestself/i18n",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./locales/*": "./locales/*"
  },
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check": "node scripts/check-locales.mjs",
    "build:cyrillic": "node scripts/transliterate.mjs --write"
  },
  "dependencies": { "i18next": "catalog:" },
  "devDependencies": {
    "@nestself/eslint-config": "workspace:*",
    "@nestself/typescript-config": "workspace:*",
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```
`tsconfig.json`: extends base, `types: ["node"]`, include `src`, `locales/**/*.json`. `eslint.config.js`: node. `vitest.config.ts`: node. Stubs: `src/index.ts` (`export {};`), `scripts/check-locales.mjs` and `scripts/transliterate.mjs` (`console.log('stub')`), `locales/en/common.json` (`{}`).

- [ ] **Step 5: `packages/sample-data`**

`package.json`: name `@nestself/sample-data`, exports `.` → `./src/index.ts`, scripts lint/typecheck/test, dependencies `@nestself/contracts: workspace:*`, devDependencies eslint-config, typescript-config, eslint, typescript, vitest (all `catalog:`/`workspace:*`). `tsconfig.json` extends base. `eslint.config.js` base. `vitest.config.ts` node. `src/index.ts`: `export {};`

- [ ] **Step 6: `packages/api-client`**

`package.json`: name `@nestself/api-client`, exports `.`, scripts lint/typecheck/test, dependencies `@nestself/contracts`, `@tanstack/react-query`, `zod`; devDependencies eslint-config, typescript-config, eslint, typescript, vitest. `tsconfig.json` extends base with `lib: ["ES2023", "DOM"]`. `eslint.config.js` base. `vitest.config.ts` node. `src/index.ts`: `export {};`

- [ ] **Step 7: `packages/ui`**

`package.json`:
```json
{
  "name": "@nestself/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": ["*.css"],
  "exports": {
    ".": "./src/index.ts",
    "./styles.css": "./src/styles.css",
    "./test": "./src/test/index.ts"
  },
  "scripts": {
    "dev": "storybook dev -p 6006 --no-open",
    "storybook:build": "storybook build",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@base-ui/react": "catalog:",
    "@nestself/assets": "workspace:*",
    "@nestself/tokens": "workspace:*",
    "@phosphor-icons/react": "catalog:",
    "clsx": "catalog:",
    "tailwind-merge": "catalog:"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@nestself/eslint-config": "workspace:*",
    "@nestself/typescript-config": "workspace:*",
    "@storybook/addon-a11y": "catalog:",
    "@storybook/react-vite": "catalog:",
    "@tailwindcss/vite": "catalog:",
    "@testing-library/dom": "catalog:",
    "@testing-library/jest-dom": "catalog:",
    "@testing-library/react": "catalog:",
    "@testing-library/user-event": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "axe-core": "catalog:",
    "eslint": "catalog:",
    "jsdom": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "storybook": "catalog:",
    "tailwindcss": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:",
    "vitest": "catalog:"
  }
}
```
`tsconfig.json`: `{ "extends": "@nestself/typescript-config/vite-react.json", "compilerOptions": { "types": ["vite/client"] }, "include": ["src", ".storybook"] }`
`eslint.config.js`: react. `vite.config.ts`: `import { defineConfig } from 'vite'; import tailwindcss from '@tailwindcss/vite'; export default defineConfig({ plugins: [tailwindcss()] });`
`vitest.config.ts`: `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, `include: ['src/**/*.test.{ts,tsx}']`, `css: false`.
Stubs: `src/index.ts` (`export {};`), `src/styles.css` (empty), `src/test/index.ts` (`export {};`), `src/test/setup.ts` (`import '@testing-library/jest-dom/vitest';`).

- [ ] **Step 8: `packages/ui-native`**

`package.json`:
```json
{
  "name": "@nestself/ui-native",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "lint": "eslint .", "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@nestself/tokens": "workspace:*",
    "phosphor-react-native": "catalog:"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-native": ">=0.80",
    "react-native-svg": ">=15"
  },
  "devDependencies": {
    "@nestself/eslint-config": "workspace:*",
    "@nestself/typescript-config": "workspace:*",
    "@types/react": "catalog:",
    "eslint": "catalog:",
    "react": "catalog:",
    "react-native": "catalog:",
    "react-native-svg": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```
`tsconfig.json`: extends react-native.json, include `src`. `eslint.config.js`: react-native. `vitest.config.ts`: node environment, include `src/**/*.test.ts` (pure helpers only). `src/index.ts`: `export {};`

- [ ] **Step 9: `apps/marketing`**

`package.json`:
```json
{
  "name": "@nestself/marketing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "images:sync": "node ../../packages/assets/scripts/sync-images.mjs public/images"
  },
  "dependencies": {
    "@nestself/assets": "workspace:*",
    "@nestself/contracts": "workspace:*",
    "@nestself/i18n": "workspace:*",
    "@nestself/tokens": "workspace:*",
    "@nestself/ui": "workspace:*",
    "@phosphor-icons/react": "catalog:",
    "i18next": "catalog:",
    "next": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "react-i18next": "catalog:"
  },
  "devDependencies": {
    "@nestself/eslint-config": "workspace:*",
    "@nestself/typescript-config": "workspace:*",
    "@tailwindcss/postcss": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "eslint": "catalog:",
    "postcss": "catalog:",
    "tailwindcss": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```
`tsconfig.json`: `{ "extends": "@nestself/typescript-config/nextjs.json", "compilerOptions": { "paths": { "@/*": ["./src/*"] } }, "include": ["next-env.d.ts", "src", "proxy.ts", "next.config.ts", ".next/types/**/*.ts"] }`
`eslint.config.js`: next. `next.config.ts`: `import type { NextConfig } from 'next'; const config: NextConfig = {}; export default config;` `postcss.config.mjs`: `export default { plugins: { '@tailwindcss/postcss': {} } };`
Stub app: `src/app/layout.tsx` (html/body passthrough), `src/app/page.tsx` (`export default function Page() { return null; }`), `next-env.d.ts` will be generated by `next build`/`dev`; create it with `/// <reference types="next" />` and `/// <reference types="next/image-types/global" />` so typecheck works before the first build.

- [ ] **Step 10: `apps/workspace` and `apps/admin`** (identical manifests except name and port)

`package.json` (workspace; admin uses `@nestself/admin` and `--port 5174`):
```json
{
  "name": "@nestself/workspace",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173 --strictPort",
    "build": "vite build",
    "preview": "vite preview --port 5173",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "images:sync": "node ../../packages/assets/scripts/sync-images.mjs public/images"
  },
  "dependencies": {
    "@nestself/api-client": "workspace:*",
    "@nestself/assets": "workspace:*",
    "@nestself/contracts": "workspace:*",
    "@nestself/i18n": "workspace:*",
    "@nestself/sample-data": "workspace:*",
    "@nestself/tokens": "workspace:*",
    "@nestself/ui": "workspace:*",
    "@phosphor-icons/react": "catalog:",
    "@tanstack/react-query": "catalog:",
    "@tanstack/react-router": "catalog:",
    "i18next": "catalog:",
    "i18next-browser-languagedetector": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "react-i18next": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@nestself/eslint-config": "workspace:*",
    "@nestself/typescript-config": "workspace:*",
    "@tailwindcss/vite": "catalog:",
    "@tanstack/react-query-devtools": "catalog:",
    "@tanstack/react-router-devtools": "catalog:",
    "@tanstack/router-plugin": "catalog:",
    "@testing-library/dom": "catalog:",
    "@testing-library/jest-dom": "catalog:",
    "@testing-library/react": "catalog:",
    "@testing-library/user-event": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react-swc": "catalog:",
    "eslint": "catalog:",
    "jsdom": "catalog:",
    "tailwindcss": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:",
    "vitest": "catalog:"
  }
}
```
`tsconfig.json`: `{ "extends": "@nestself/typescript-config/vite-react.json", "compilerOptions": { "types": ["vite/client"] }, "include": ["src", "vite.config.ts", "vitest.config.ts"] }`
`eslint.config.js`: react. `index.html`, `vite.config.ts`, `src/main.tsx` stubs (Task 3.2 writes the real ones): `vite.config.ts` = `import { defineConfig } from 'vite'; export default defineConfig({});`, `src/main.tsx` = `export {};`, `index.html` minimal with `<div id="root"></div>` and `<script type="module" src="/src/main.tsx"></script>`.

- [ ] **Step 11: `apps/mobile`**

`package.json`:
```json
{
  "name": "@nestself/mobile",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "ios": "expo run:ios",
    "android": "expo run:android",
    "export": "expo export --platform ios --output-dir dist",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@nestself/api-client": "workspace:*",
    "@nestself/assets": "workspace:*",
    "@nestself/contracts": "workspace:*",
    "@nestself/i18n": "workspace:*",
    "@nestself/sample-data": "workspace:*",
    "@nestself/tokens": "workspace:*",
    "@nestself/ui-native": "workspace:*",
    "@react-native-async-storage/async-storage": "catalog:",
    "expo": "catalog:",
    "expo-constants": "catalog:",
    "expo-font": "catalog:",
    "expo-image": "catalog:",
    "expo-linking": "catalog:",
    "expo-localization": "catalog:",
    "expo-router": "catalog:",
    "expo-splash-screen": "catalog:",
    "expo-status-bar": "catalog:",
    "expo-system-ui": "catalog:",
    "i18next": "catalog:",
    "phosphor-react-native": "catalog:",
    "react": "catalog:",
    "react-i18next": "catalog:",
    "react-native": "catalog:",
    "react-native-safe-area-context": "catalog:",
    "react-native-screens": "catalog:",
    "react-native-svg": "catalog:"
  },
  "devDependencies": {
    "@nestself/eslint-config": "workspace:*",
    "@nestself/typescript-config": "workspace:*",
    "@types/react": "catalog:",
    "babel-preset-expo": "catalog:",
    "eslint": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```
`tsconfig.json`: `{ "extends": "expo/tsconfig.base", "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true, "paths": { "@/*": ["./src/*"] } }, "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"], "exclude": ["node_modules", "dist"] }`
`eslint.config.js`: react-native. `app.json` stub: `{ "expo": { "name": "NestSelf", "slug": "nestself-mobile", "scheme": "nestself" } }`. `babel.config.js`: `module.exports = (api) => { api.cache(true); return { presets: ['babel-preset-expo'] }; };` `src/app/_layout.tsx` stub: `export default function Layout() { return null; }`. `expo-env.d.ts`: `/// <reference types="expo/types" />`.

- [ ] **Step 12: `apps/api`**

`package.json`:
```json
{
  "name": "@nestself/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy",
    "prisma:seed": "tsx prisma/seed.ts",
    "openapi": "EMIT_OPENAPI=true node dist/main.js"
  },
  "dependencies": {
    "@nestjs/common": "catalog:",
    "@nestjs/config": "catalog:",
    "@nestjs/core": "catalog:",
    "@nestjs/jwt": "catalog:",
    "@nestjs/platform-express": "catalog:",
    "@nestjs/swagger": "catalog:",
    "@nestjs/terminus": "catalog:",
    "@nestjs/throttler": "catalog:",
    "@nestself/contracts": "workspace:*",
    "@nestself/sample-data": "workspace:*",
    "@prisma/adapter-pg": "catalog:",
    "@prisma/client": "catalog:",
    "dotenv": "catalog:",
    "helmet": "catalog:",
    "nestjs-pino": "catalog:",
    "pg": "catalog:",
    "pino": "catalog:",
    "pino-http": "catalog:",
    "reflect-metadata": "catalog:",
    "rxjs": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@nestjs/cli": "catalog:",
    "@nestjs/testing": "catalog:",
    "@nestself/eslint-config": "workspace:*",
    "@nestself/typescript-config": "workspace:*",
    "@swc/core": "catalog:",
    "@swc/helpers": "catalog:",
    "@types/node": "catalog:",
    "@types/pg": "catalog:",
    "@types/supertest": "catalog:",
    "eslint": "catalog:",
    "pino-pretty": "catalog:",
    "prisma": "catalog:",
    "supertest": "catalog:",
    "tsx": "catalog:",
    "typescript": "catalog:",
    "unplugin-swc": "catalog:",
    "vitest": "catalog:"
  }
}
```
`tsconfig.json`: `{ "extends": "@nestself/typescript-config/nestjs.json", "compilerOptions": { "outDir": "./dist", "baseUrl": "./" }, "include": ["src", "test", "prisma.config.ts", "prisma/seed.ts"] }`
`tsconfig.build.json`: `{ "extends": "./tsconfig.json", "exclude": ["node_modules", "test", "dist", "**/*.spec.ts", "prisma", "prisma.config.ts"] }`
`nest-cli.json`: `{ "$schema": "https://json.schemastore.org/nest-cli", "collection": "@nestjs/schematics", "sourceRoot": "src", "compilerOptions": { "builder": "swc", "typeCheck": true, "deleteOutDir": true } }`
`eslint.config.js`: node. `vitest.config.ts`: `import swc from 'unplugin-swc'; import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'], environment: 'node' }, plugins: [swc.vite({ module: { type: 'es6' } })] });`
Stubs: `src/main.ts` (`console.log('stub');`), `prisma/schema.prisma` with only `datasource db { provider = "postgresql" }` and `generator client { provider = "prisma-client" output = "../src/generated/prisma" }`, `prisma.config.ts` stub (see Task 3.5 for the real one; the stub must import nothing that fails: `export default {};`).

- [ ] **Step 13: `e2e/tsconfig.json`** — `{ "extends": "@nestself/typescript-config/base.json", "compilerOptions": { "types": ["node"], "lib": ["ES2023", "DOM"] }, "include": ["./**/*.ts", "../playwright.config.ts"] }` and `e2e/.gitkeep`.

### Task 0.5: Install once, verify the graph, commit

- [ ] **Step 1: Install**

Run: `cd /Users/draganpodrascanin/Desktop/projects/Nestself && pnpm install 2>&1 | tail -40`
Expected: ends with `Done in …`. If the output contains `Ignored build scripts:` followed by package names, add those names to `onlyBuiltDependencies` in `pnpm-workspace.yaml` and run `pnpm install` again until no package is listed as ignored.

- [ ] **Step 2: Verify the task graph and the stubs**

Run: `pnpm turbo run typecheck lint --dry=json 2>/dev/null | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(j.tasks.map(t=>t.taskId).sort().join('\n'))"`
Expected: a `typecheck` and `lint` task for every workspace that defines the script (apps and packages, not the config packages).

Run: `pnpm typecheck 2>&1 | tail -20`
Expected: all tasks successful. Fix stub-level errors (for example missing `types`) in the manifests, never by adding dependencies.

Run: `pnpm check:deps`
Expected: no mismatched versions (all `catalog:`), exit 0. If sherif complains about `catalog:` protocol support, record it and continue.

- [ ] **Step 3: Playwright browser**

Run: `pnpm exec playwright install chromium 2>&1 | tail -3`
Expected: chromium downloaded (one-time, ~150 MB).

- [ ] **Step 4: Commit (orchestrator)**

```bash
git add -A && git commit -m "chore: monorepo foundation (pnpm workspace, turbo, configs, manifests)"
```

---

## Phase 1 — Design layer and shared packages (six parallel workers)

Each task owns exactly one package directory. Nothing else is touched.

### Task 1.1: `packages/tokens` — the framework-independent token layer

**Files:**
- Create: `tokens.json`, `tokens.css`, `tailwind.css`, `contrast-report.json`, `src/index.ts`, `src/native.ts`, `src/theme.ts`, `src/theme.test.ts`, `src/native.test.ts`, `src/smoke.test.ts`, `README.md`

- [ ] **Step 1: Copy the handoff data verbatim**

```bash
cp docs/design-handoff/data/tokens.json packages/tokens/tokens.json
cp docs/design-handoff/data/contrast-report.json packages/tokens/contrast-report.json
cp docs/design-handoff/styles/tokens.css packages/tokens/tokens.css
```
Then append to `tokens.css` the dark-mode shadow override that the handoff keeps in `styles.css` (it is a token):
```css
html[data-mode="dark"] { --shadow-low: 0 1px 3px rgb(0 0 0 / 18%); --shadow-menu: 0 4px 16px rgb(0 0 0 / 28%); --shadow-modal: 0 16px 48px rgb(0 0 0 / 38%); }
```
Do not change any other value. The smoke test compares the file with the JSON.

- [ ] **Step 2: Write the failing smoke test `src/smoke.test.ts`**

It must implement these checks (the research draft is a starting point; adapt the paths):
1. `tokens.css` contains exactly 8 blocks matching `/(?::root,\s*)?html\[data-palette="(\w+)"\]\[data-mode="(\w+)"\]\s*\{([^}]+)\}/g`; each declares exactly 27 `--color-*` properties; the property names equal the keys of `tokens.json.themes[palette][mode]`; every value equals the JSON value case-insensitively (compare `rgb(...)` strings verbatim).
2. `contrast-report.json` has 120 entries; for each entry with two hex values, recompute the WCAG contrast ratio with the sRGB formula (`c/255`, `<= 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`, `L = 0.2126R + 0.7152G + 0.0722B`, `(Lmax+0.05)/(Lmin+0.05)`); assert `toBeCloseTo(entry.ratio, 1)` and `>= entry.minimum`.
3. No raw hex colour literal (`/#[0-9a-f]{3,8}\b/i`) in any `.css`, `.ts`, `.tsx` file under `packages/ui/src`, `packages/ui-native/src`, `apps/*/src`, skipping files named `*.test.*`, `routeTree.gen.ts` and `src/generated`. The test walks the directories with `node:fs`; directories that do not exist yet are skipped (so the test passes in Phase 1 and becomes meaningful later).
4. `packages/assets/fonts/fonts.css` (skip if missing) declares no `@font-face` block that contains both `Onest` and `font-style: italic`, and contains `font-synthesis: none`.
5. `tokens.json.default` equals `{ palette: 'forest', mode: 'light', font: 'onest' }` and `tokens.json.themes` has keys `forest, ink, plum, azure`.

Run: `pnpm --filter @nestself/tokens test`
Expected: FAIL on check 1 if the appended override block is malformed, otherwise PASS for 1, 2, 5 and skip-pass for 3, 4. (The test is written first so that later regressions are caught; record which assertions executed.)

- [ ] **Step 3: Write `tailwind.css` — the `@theme inline` bridge**

Every utility resolves to the live CSS variable so palette, mode and font switch at runtime without a rebuild. Keep Tailwind's default numeric spacing (0.25rem base): the handoff scale 2/4/8/12/16/20/24/32/40/48/64/80/96 px maps to `0.5/1/2/3/4/5/6/8/10/12/16/20/24`.

```css
/* @nestself/tokens/tailwind.css — Tailwind v4 theme bridge. Import after tokens.css. */
@theme inline {
  --color-canvas: var(--color-canvas);
  --color-surface: var(--color-surface);
  --color-raised: var(--color-raised);
  --color-tint: var(--color-tint);
  --color-text: var(--color-text);
  --color-text-secondary: var(--color-text-secondary);
  --color-border-subtle: var(--color-border-subtle);
  --color-border-control: var(--color-border-control);
  --color-primary: var(--color-primary);
  --color-primary-hover: var(--color-primary-hover);
  --color-primary-pressed: var(--color-primary-pressed);
  --color-on-primary: var(--color-on-primary);
  --color-accent: var(--color-accent);
  --color-on-accent: var(--color-on-accent);
  --color-accent-soft: var(--color-accent-soft);
  --color-focus: var(--color-focus);
  --color-disabled-surface: var(--color-disabled-surface);
  --color-disabled-text: var(--color-disabled-text);
  --color-scrim: var(--color-scrim);
  --color-success: var(--color-success);
  --color-success-surface: var(--color-success-surface);
  --color-warning: var(--color-warning);
  --color-warning-surface: var(--color-warning-surface);
  --color-danger: var(--color-danger);
  --color-danger-surface: var(--color-danger-surface);
  --color-info: var(--color-info);
  --color-info-surface: var(--color-info-surface);

  --radius-small: var(--radius-small);
  --radius-control: var(--radius-control);
  --radius-card: var(--radius-card);
  --radius-modal: var(--radius-modal);
  --radius-sheet: var(--radius-sheet);
  --radius-pill: var(--radius-pill);

  --shadow-low: var(--shadow-low);
  --shadow-menu: var(--shadow-menu);
  --shadow-modal: var(--shadow-modal);

  --font-body: var(--font-body);
  --font-heading: var(--font-heading);
  --font-code: var(--font-code);

  --font-weight-body: var(--font-weight-body);
  --font-weight-label: var(--font-weight-label);
  --font-weight-strong: var(--font-weight-strong);

  --ease-standard: var(--motion-ease);

  --container-marketing: var(--content-marketing);
  --container-employee: var(--content-employee);
  --container-hr: var(--content-hr);
  --container-form: var(--content-form);
  --container-reading: var(--reading-width);
}
```
Note: durations are not themeable through `@theme` in a way that follows `prefers-reduced-motion` at runtime, so components use `duration-[var(--motion-fast)]` style arbitrary values (`transition-[background-color] duration-[var(--motion-fast)] ease-standard`). Z-index uses arbitrary values `z-[var(--z-dialog)]`.

- [ ] **Step 4: Write `src/index.ts`** (typed access to the JSON)

```ts
import tokensJson from '../tokens.json';

export const tokens = tokensJson;
export const palettes = ['forest', 'ink', 'plum', 'azure'] as const;
export const modes = ['light', 'dark'] as const;
export const fonts = ['onest', 'commissioner', 'nunito', 'fira', 'lato'] as const;
export type Palette = (typeof palettes)[number];
export type Mode = (typeof modes)[number];
export type FontId = (typeof fonts)[number];
export type ThemeSelection = { palette: Palette; mode: Mode; font: FontId };
export const DEFAULT_THEME: ThemeSelection = { palette: 'forest', mode: 'light', font: 'onest' };

export type ThemeColors = (typeof tokensJson)['themes']['forest']['light'];
export type SemanticColor = keyof ThemeColors;
export const themes = tokensJson.themes;
export const themeMeta = Object.fromEntries(
  palettes.map((p) => [p, { name: tokensJson.themes[p].name, subtitle: tokensJson.themes[p].subtitle, description: tokensJson.themes[p].description }]),
) as Record<Palette, { name: string; subtitle: string; description: string }>;

export const space = tokensJson.primitive.space;
export const radius = tokensJson.primitive.radius;
export const borderWidth = tokensJson.primitive.borderWidth;
export const shadow = tokensJson.primitive.shadow;
export const zIndex = tokensJson.primitive.zIndex;
export const motion = tokensJson.primitive.motion;
export const typography = tokensJson.typography;
export const layout = tokensJson.layout;
export const components = tokensJson.components;
export const iconMapping = tokensJson.iconMapping;
export type IconCategory = keyof typeof iconMapping;
export const requiredStates = tokensJson.requiredStates;
export const patterns = tokensJson.patterns;
export const semanticRoles = tokensJson.semanticRoles;
export const accessibility = tokensJson.accessibility;
export const photography = tokensJson.photography;

export function isPalette(v: unknown): v is Palette { return typeof v === 'string' && (palettes as readonly string[]).includes(v); }
export function isMode(v: unknown): v is Mode { return typeof v === 'string' && (modes as readonly string[]).includes(v); }
export function isFont(v: unknown): v is FontId { return typeof v === 'string' && (fonts as readonly string[]).includes(v); }
```

- [ ] **Step 5: Write `src/theme.ts`** (framework-free runtime, works with any `Document`/`Storage`)

Exports: `THEME_STORAGE_KEY = 'nestself-theme'`, `applyTheme(selection, doc = document)` sets `data-palette`, `data-mode`, `data-font` on `doc.documentElement`; `readTheme(doc)` reads them back with guards and falls back to `DEFAULT_THEME`; `persistTheme(selection, storage = localStorage)` / `loadPersistedTheme(storage)` (JSON, guarded, try/catch so a blocked storage never throws); `systemPrefersDark(win = window)`; `resolveInitialTheme({ storage, win })` = persisted ?? default (mode stays `light` by default; `followSystem` is an explicit opt-in parameter). Also `themeBootScript()` returning a string of inline JS that applies the persisted theme before first paint (used by marketing `<head>` and the SPA `index.html`): it must only read the storage key, validate against the three allowed lists, and set the attributes.

Tests `src/theme.test.ts` (`// @vitest-environment jsdom` at the top): apply then read round-trips; invalid stored JSON falls back to default; `themeBootScript()` evaluated with `new Function` in jsdom sets the attributes from a stored value and ignores an invalid palette.

- [ ] **Step 6: Write `src/native.ts`**

Derive from the JSON, no new values:
```ts
export type NativeColors = { canvas: string; surface: string; raised: string; tint: string; text: string; textSecondary: string; borderSubtle: string; borderControl: string; primary: string; primaryHover: string; primaryPressed: string; onPrimary: string; accent: string; onAccent: string; accentSoft: string; focus: string; disabledSurface: string; disabledText: string; scrim: string; success: string; successSurface: string; warning: string; warningSurface: string; danger: string; dangerSurface: string; info: string; infoSurface: string };
export const nativeThemes: Record<Palette, Record<Mode, NativeColors>>;   // kebab → camel, same hex values
export const nativeSpace = { 0: 0, 2: 2, 4: 4, 8: 8, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, 40: 40, 48: 48, 64: 64, 80: 80, 96: 96 } (dp, from primitive.space)
export const nativeRadius (from primitive.radius), nativeBorderWidth, nativeMotion (ms), nativeTarget = { ios: 48, android: 48 }
export type TypeRole = 'display' | 'editorialHeading' | 'screenTitle' | 'sectionTitle' | 'bodyLarge' | 'body' | 'label' | 'metadata' | 'table';
export const nativeType: Record<'ios' | 'android', Record<TypeRole, { fontSize: number; lineHeight: number; fontWeight: '400' | '600' | '700'; letterSpacing: number }>>; // from typography.styles[role].ios / .android and .weight; letterSpacing = trackingEm * fontSize when trackingEm is an object use .ios/.android
export const nativeFontFiles = { regular: 'Onest-Regular', semibold: 'Onest-SemiBold', bold: 'Onest-Bold' } as const;
```
Tests `src/native.test.ts`: every palette/mode has all 27 keys and the values equal the JSON; `nativeType.ios.body.fontSize === 17`; `nativeType.android.body.fontSize === 16`; weights are strings.

- [ ] **Step 7: Run everything**

Run: `pnpm --filter @nestself/tokens lint && pnpm --filter @nestself/tokens typecheck && pnpm --filter @nestself/tokens test`
Expected: PASS. Then write `README.md` with the mapping table: handoff token → CSS variable → Tailwind utility → native key, and the rule "palette values live only in tokens.css / tokens.json".

### Task 1.2: `packages/assets` — fonts, photos, icons, image pipeline, credits

**Files:**
- Create: `fonts/*.woff2` (19), `fonts/*-OFL.txt` (5), `fonts/native/Onest-Regular.ttf`, `fonts/native/Onest-SemiBold.ttf`, `fonts/native/Onest-Bold.ttf`, `fonts/native/OFL.txt`, `fonts/fonts.css`, `photos/*.jpg` (10), `photos.json`, `icons/*.svg` (Phosphor subset), `icons/PHOSPHOR-LICENSE.txt`, `scripts/build-images.mjs`, `scripts/sync-images.mjs`, `scripts/build-credits.mjs`, `src/index.ts`, `src/index.test.ts`, `src/build.test.ts`, `README.md`

- [ ] **Step 1: Copy the assets**

```bash
cp docs/design-handoff/assets/fonts/*.woff2 docs/design-handoff/assets/fonts/*-OFL.txt packages/assets/fonts/
mkdir -p packages/assets/fonts/native
cp /private/tmp/claude-501/-Users-draganpodrascanin-Desktop-projects-Nestself/3841c7b3-c734-41e5-ae5f-cb494614968e/scratchpad/onest-release/extracted/onest-2.001/fonts/ttf/Onest-{Regular,SemiBold,Bold}.ttf packages/assets/fonts/native/
cp /private/tmp/claude-501/-Users-draganpodrascanin-Desktop-projects-Nestself/3841c7b3-c734-41e5-ae5f-cb494614968e/scratchpad/onest-release/extracted/onest-2.001/OFL.txt packages/assets/fonts/native/OFL.txt
cp docs/design-handoff/assets/photos/*.jpg packages/assets/photos/
cd docs/design-handoff/assets/icons && cp $(ls | grep -v '^iconoir-' | grep -v ICONOIR) ../../../../packages/assets/icons/ && cd -
```
Iconoir files stay in the handoff only (comparison assets, not production).

- [ ] **Step 2: Write `fonts/fonts.css`** — the handoff `styles/fonts.css` with paths changed from `../assets/fonts/X.woff2` to `./X.woff2`, plus:
```css
html { font-synthesis: none; font-optical-sizing: auto; }
```
Onest must have exactly three faces (400/600/700, normal). The four italic faces of the other families stay.

- [ ] **Step 3: Write `photos.json`** — the ten entries of `docs/design-handoff/data/photo-sources.json` with `asset` changed to `photos/<key>.jpg` and two new fields from the real files: `width` and `height` (`sips -g pixelWidth -g pixelHeight`): all 1600×1067 except `grandfather` 1600×1068, `family-carry` 1067×1600, `family-play` 1067×1600.

- [ ] **Step 4: Write `src/index.ts`**

```ts
import photosJson from '../photos.json';

export type PhotoKey = 'family-grass' | 'family-autumn' | 'grandfather' | 'older-couple' | 'family-carry' | 'family-play' | 'care-home' | 'couple-cooking' | 'friends-men' | 'friends-bench';
export type ImageRole = 'hero-3x2' | 'hero-4x5' | 'portrait' | 'card' | 'avatar' | 'article';
export type ImageFormat = 'avif' | 'webp' | 'jpg';
export interface Photo { key: PhotoKey; id: number; author: string; source: string; license: string; width: number; height: number; focalPoint: { x: number; y: number }; status: string; usage: string; asset: string }

export const photos = photosJson as Photo[];
export const photoByKey = Object.fromEntries(photos.map((p) => [p.key, p])) as Record<PhotoKey, Photo>;
export const RESPONSIVE_WIDTHS = [480, 768, 1024, 1280, 1600] as const;
export const IMAGE_FORMATS: ImageFormat[] = ['avif', 'webp', 'jpg'];
export const CROP_SPECS: Record<ImageRole, { width: number; height: number; targetKB: number; aspectRatio: string }> = {
  'hero-3x2': { width: 1600, height: 1067, targetKB: 200, aspectRatio: '3:2' },
  'hero-4x5': { width: 800, height: 1000, targetKB: 200, aspectRatio: '4:5' },
  portrait: { width: 800, height: 1000, targetKB: 150, aspectRatio: '4:5' },
  card: { width: 800, height: 450, targetKB: 80, aspectRatio: '16:9' },
  avatar: { width: 320, height: 320, targetKB: 35, aspectRatio: '1:1' },
  article: { width: 1200, height: 675, targetKB: 120, aspectRatio: '16:9' },
};
export const IMAGE_BASE_PATH = '/images';

/** Widths actually generated for a photo (never enlarged). */
export function availableWidths(key: PhotoKey): number[] { return RESPONSIVE_WIDTHS.filter((w) => w <= photoByKey[key].width); }
/** `/images/<key>/<key>-<width>.<ext>` */
export function variantPath(key: PhotoKey, width: number, format: ImageFormat): string { return `${IMAGE_BASE_PATH}/${key}/${key}-${width}.${format}`; }
export function cropPath(key: PhotoKey, role: ImageRole, format: ImageFormat): string { return `${IMAGE_BASE_PATH}/${key}/${key}-${role}.${format}`; }
export function srcSet(key: PhotoKey, format: ImageFormat): string { return availableWidths(key).map((w) => `${variantPath(key, w, format)} ${w}w`).join(', '); }
/** CSS object-position from the normalized focal point, e.g. "50% 54%". */
export function focalObjectPosition(key: PhotoKey): string { const f = photoByKey[key].focalPoint; return `${Math.round(f.x * 100)}% ${Math.round(f.y * 100)}%`; }
/** expo-image contentPosition from the focal point. */
export function focalContentPosition(key: PhotoKey): { top: `${number}%`; left: `${number}%` } { const f = photoByKey[key].focalPoint; return { top: `${Math.round(f.y * 100)}%`, left: `${Math.round(f.x * 100)}%` }; }
export const fontFiles = { web: { onest: ['Onest-Regular.woff2', 'Onest-SemiBold.woff2', 'Onest-Bold.woff2'] }, native: { onest: ['native/Onest-Regular.ttf', 'native/Onest-SemiBold.ttf', 'native/Onest-Bold.ttf'] } } as const;
```
Tests `src/index.test.ts`: 10 photos, focal points within 0..1, `availableWidths('family-carry')` equals `[480, 768, 1024]`, `srcSet('family-grass','avif')` contains ` 1600w`, `focalObjectPosition('family-grass') === '50% 54%'`, every photo has author, source URL on pexels.com and the licence URL.

- [ ] **Step 5: Write `scripts/build-images.mjs`** (plain ESM JavaScript, `sharp` only)

Behaviour: read `photos.json`; for each photo produce `dist/images/<key>/<key>-<w>.{avif,webp,jpg}` for widths ≤ source width (`fit: 'inside', withoutEnlargement: true`) and `dist/images/<key>/<key>-<role>.{avif,webp,jpg}` for the six roles with the focal-point crop (extract a region of the target aspect ratio centred on `focalX*width, focalY*height`, clamped to bounds, then resize to the spec); encode with `avif { quality: 50, effort: 4 }`, `webp { quality: 72 }`, `jpeg { quality: 78, mozjpeg: true }`; when a role variant exceeds `targetKB`, lower quality by `sqrt(target/actual)` up to 3 passes but never below 35; write `dist/manifest.json` `{ generated, photos: [{ key, variants: [{ width, height, format, path, bytes }], crops: [{ role, format, width, height, path, bytes }] }] }`. Flags: `--only <key>` and `--widths 480` for quick runs. Print one line per photo and a total. Exit non-zero on any sharp error.

- [ ] **Step 6: Write `scripts/sync-images.mjs <targetDir>`** — copies `dist/images` into the given directory (relative to the current working directory) with `fs.cpSync(..., { recursive: true })`, creating it; if `dist/images` is missing, print `run "pnpm --filter @nestself/assets build" first` and exit 1. Idempotent.

- [ ] **Step 7: Write `scripts/build-credits.mjs`** — writes `CREDITS.md` at the repository root with three sections: Photographs (table: key, photographer, Pexels link, licence link; the handoff sentence that people shown are not customers, experts, endorsers or evidence of outcomes and that family imagery implies no eligibility), Fonts (Onest, Commissioner, Nunito Sans, Fira Sans, Lato, each OFL 1.1 with the source URL from `docs/design-handoff/data/sources.json`), Icons (Phosphor, MIT). Deterministic output.

- [ ] **Step 8: Write `src/build.test.ts`** — runs `build-images.mjs --only family-carry --widths 480` with `node:child_process` into a temp `dist` (set `NESTSELF_IMAGES_OUT=<tmp>` env var honoured by the script) and asserts `family-carry-480.avif`, `.webp`, `.jpg` exist with `bytes > 1000`, plus the six role crops. Timeout 120 s.

- [ ] **Step 9: Build for real and verify**

Run: `pnpm --filter @nestself/assets build 2>&1 | tail -15`
Expected: 10 lines `<key>: N variants, 6 crops` and `manifest written`. Takes a few minutes (AVIF). Then `pnpm --filter @nestself/assets test` and lint/typecheck pass, and `node packages/assets/scripts/build-credits.mjs` writes `CREDITS.md`.

Write `README.md`: asset policy (lifestyle only, credits required, focal points, no beige filter), how to add a photo (append to photos.json with focal point and credit, rebuild), native font note (TTF from upstream Onest 2.001, OFL).

### Task 1.3: `packages/contracts`

**Files:** `src/roles.ts`, `src/locale.ts`, `src/support.ts`, `src/health.ts`, `src/access-model.ts`, `src/index.ts`, `src/contracts.test.ts`

- [ ] **Step 1: Write the schemas**

```ts
// src/roles.ts
import { z } from 'zod';
export const orgRoles = ['employee', 'manager', 'hr_admin'] as const;
export const OrgRoleSchema = z.enum(orgRoles);
export type OrgRole = z.infer<typeof OrgRoleSchema>;
export const platformRoles = ['expert', 'operations', 'admin'] as const;
export const PlatformRoleSchema = z.enum(platformRoles);
export type PlatformRole = z.infer<typeof PlatformRoleSchema>;
/** Session shape every client and the API agree on. The API is the only enforcement point. */
export const SessionSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string().min(1),
  initials: z.string().min(1).max(3),
  orgId: z.string().min(1).nullable(),
  orgRole: OrgRoleSchema.nullable(),
  platformRole: PlatformRoleSchema.nullable(),
  locale: z.enum(['en', 'sr-Latn', 'sr-Cyrl']).default('en'),
});
export type Session = z.infer<typeof SessionSchema>;
export const canAccessHr = (s: Pick<Session, 'orgRole'>) => s.orgRole === 'hr_admin';
export const canManageTeam = (s: Pick<Session, 'orgRole'>) => s.orgRole === 'manager' || s.orgRole === 'hr_admin';
```
```ts
// src/locale.ts
import { z } from 'zod';
export const locales = ['en', 'sr-Latn', 'sr-Cyrl'] as const;
export const LocaleSchema = z.enum(locales);
export type Locale = z.infer<typeof LocaleSchema>;
export const defaultLocale: Locale = 'en';
```
```ts
// src/support.ts
import { z } from 'zod';
export const supportAreas = ['psychological', 'legal', 'financial'] as const;
export const SupportAreaSchema = z.enum(supportAreas);
export type SupportArea = z.infer<typeof SupportAreaSchema>;
/** Maps a support area to the token icon category (tokens.json iconMapping). */
export const supportAreaIcon = { psychological: 'mentalSupport', legal: 'legal', financial: 'financial' } as const;
```
```ts
// src/health.ts — mirrors @nestjs/terminus output
import { z } from 'zod';
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'error', 'shutting_down']),
  info: z.record(z.string(), z.object({ status: z.string() }).loose()).optional(),
  error: z.record(z.string(), z.object({ status: z.string() }).loose()).optional(),
  details: z.record(z.string(), z.object({ status: z.string() }).loose()).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
```
```ts
// src/access-model.ts — the handoff's PROPOSED access matrix as data. Not a claim of enforcement.
export const accessModel = {
  note: 'Proposed design model from the handoff. Enforcement happens server-side when the service exists; hiding UI is not access control.',
  rows: [
    { data: 'Conversation content', employee: 'Own', advisor: 'Assigned case only', hr: 'No view', operations: 'Exceptional, specifically authorised access only' },
    { data: 'Appointments / support history', employee: 'Own', advisor: 'Needed scope', hr: 'No individual view', operations: 'Needed operational scope' },
    { data: 'Benefit eligibility', employee: 'Own', advisor: 'As needed', hr: 'Eligibility administration', operations: 'Authorised administration' },
    { data: 'Company fund', employee: 'Relevant coverage', advisor: 'As needed for billing', hr: 'Programme total', operations: 'Authorised administration' },
    { data: 'Usage reporting', employee: 'Own history', advisor: 'Professional scope', hr: 'Protected aggregates', operations: 'Authorised scope' },
  ],
} as const;
```
`src/index.ts` re-exports everything. Tests: `OrgRoleSchema.parse('hr_admin')` ok, `'owner'` throws; `SessionSchema` defaults locale; `HealthResponseSchema` accepts `{ status: 'ok', info: { database: { status: 'up' } }, details: {} }`; `canAccessHr` only for hr_admin.

### Task 1.4: `packages/i18n` — one i18next setup for four apps

**Files:** `src/types.ts`, `src/config.ts`, `src/format.ts`, `src/resources.ts`, `src/i18next.d.ts`, `src/index.ts`, `src/*.test.ts`, `locales/{en,sr-Latn,sr-Cyrl}/{common,marketing,workspace,admin,mobile}.json`, `scripts/transliterate.mjs`, `scripts/transliteration-exceptions.json`, `scripts/check-locales.mjs`, `README.md`

- [ ] **Step 1: Types and config**

```ts
// src/types.ts
export const locales = ['en', 'sr-Latn', 'sr-Cyrl'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';
export const namespaces = ['common', 'marketing', 'workspace', 'admin', 'mobile'] as const;
export type Namespace = (typeof namespaces)[number];
export const localeMeta: Record<Locale, { htmlLang: string; hreflang: string; intl: string; nativeName: string; script: 'Latn' | 'Cyrl'; dir: 'ltr' }> = {
  en: { htmlLang: 'en', hreflang: 'en', intl: 'en-GB', nativeName: 'English', script: 'Latn', dir: 'ltr' },
  'sr-Latn': { htmlLang: 'sr-Latn', hreflang: 'sr-Latn', intl: 'sr-Latn-RS', nativeName: 'Srpski', script: 'Latn', dir: 'ltr' },
  'sr-Cyrl': { htmlLang: 'sr-Cyrl', hreflang: 'sr-Cyrl', intl: 'sr-Cyrl-RS', nativeName: 'Српски', script: 'Cyrl', dir: 'ltr' },
};
export function isLocale(v: unknown): v is Locale { return typeof v === 'string' && (locales as readonly string[]).includes(v); }
/** Picks the best supported locale from BCP 47 tags such as "sr-Latn-RS", "sr-RS", "sr", "en-US". Bare "sr" maps to sr-Latn. */
export function negotiateLocale(candidates: readonly string[], fallback: Locale = defaultLocale): Locale;
```
`negotiateLocale` rules: exact match first; then strip region (`sr-Latn-RS` → `sr-Latn`); then language only (`sr-*` → `sr-Latn`, `en-*` → `en`); else fallback. Also export `parseAcceptLanguage(header: string): string[]` (quality-sorted tags) for the marketing proxy.

```ts
// src/config.ts
import type { InitOptions } from 'i18next';
import { defaultLocale, locales, namespaces } from './types';
export const i18nBaseOptions: InitOptions = {
  supportedLngs: [...locales],
  fallbackLng: { 'sr-Cyrl': ['sr-Latn', 'en'], 'sr-Latn': ['en'], default: ['en'] },
  load: 'currentOnly',                 // keeps sr-Latn and sr-Cyrl distinct
  defaultNS: 'common',
  ns: [...namespaces],
  interpolation: { escapeValue: false },
  returnNull: false,
};
export const defaultLng = defaultLocale;
```
`src/resources.ts` statically imports all 15 JSON files and exports `resources` (`{ en: { common, ... }, 'sr-Latn': {...}, 'sr-Cyrl': {...} }`) and `resourcesFor(ns: Namespace[])`. All apps bundle resources statically (simplest, works on React Native, and the catalogs are small).

`src/format.ts`: `formatCurrency(amount, currency: 'EUR' | 'RSD', locale)` using `Intl.NumberFormat(localeMeta[locale].intl, { style: 'currency', currency, minimumFractionDigits: 2 })` (RSD explicitly 2 fraction digits because ISO says 0 and the handoff shows decimals), `formatDate(date, locale, opts)` and `formatTime(date, locale)` with `timeZone: 'Europe/Belgrade'`, `formatDateTime`. Tests: `formatCurrency(45, 'EUR', 'en') === '€45.00'`, sr-Latn output contains `45,00`, sr-Cyrl date for 2026-10-21 contains `октобар`, sr-Latn contains `oktobar`.

`src/i18next.d.ts`: `CustomTypeOptions` with `defaultNS: 'common'` and `resources: typeof en-resources` (types from the English JSON).

- [ ] **Step 2: Catalogs — English first**

Write `locales/en/common.json` exactly:
```json
{
  "brand": { "name": "NestSelf", "tagline": "A little more room for life." },
  "nav": { "home": "Home", "support": "Support", "appointments": "Appointments", "messages": "Messages", "channels": "Channels", "polls": "Polls", "settings": "Settings", "manage": "Manage", "hr": "Employer space", "menu": "Menu", "skipToContent": "Skip to content", "back": "Back", "close": "Close", "openMenu": "Open menu", "closeMenu": "Close menu" },
  "action": { "continue": "Continue", "cancel": "Cancel", "confirm": "Confirm", "save": "Save", "retry": "Try again", "send": "Send", "search": "Search", "clearFilters": "Clear filters", "viewTotal": "View total", "viewCoverage": "View coverage", "backToOverview": "Back to overview", "findTime": "Find a time", "checkAgain": "Check again", "startAgain": "Start the example again", "readMore": "Read more" },
  "state": { "loading": "Loading", "empty": { "title": "No appointments yet", "body": "Find a time when you are ready." }, "results": { "title": "No times match these filters", "body": "Try another day or remove a filter." }, "offline": { "title": "Your message has not been sent", "body": "The draft is still here. Reconnect, then try again." }, "stale": { "title": "Availability may have changed", "body": "Last checked at {{time}}. Check again before confirming." }, "permission": { "title": "This view is not available to your role", "body": "Return to a place you can access or contact support." }, "expired": { "title": "Check your current coverage", "body": "The benefit may have changed. The available options are explained without removing your history." }, "protected": { "title": "This breakdown is protected", "body": "There are not enough people to show this group safely." } },
  "form": { "required": "This field is required", "invalidEmail": "Enter a valid work email address", "errorSummaryTitle": "Check the highlighted fields", "goToField": "Go to the {{field}} field", "optional": "optional" },
  "role": { "employee": "Employee", "manager": "Manager", "hr_admin": "HR administrator", "expert": "Expert", "operations": "Operations", "admin": "Administrator" },
  "area": { "psychological": "Psychological support", "legal": "Legal guidance", "financial": "Financial guidance" },
  "theme": { "palette": "Palette", "mode": "Mode", "font": "Typeface", "light": "Light", "dark": "Dark", "forest": "Forest & Mint", "ink": "Ink & Ice", "plum": "Plum & Mist", "azure": "Azure & Sun", "designControls": "Design controls (development only)" },
  "locale": { "label": "Language", "en": "English", "sr-Latn": "Srpski (latinica)", "sr-Cyrl": "Српски (ћирилица)" },
  "sample": { "banner": "Sample data. Nothing here is real, saved or sent.", "demoNoop": "This is a demonstration. No appointment, payment or message was created." },
  "privacy": { "whoCanSee": "Who can see this?", "pointOfUse": "Your own conversations and appointments are yours. Your employer sees eligibility administration, programme budget and protected aggregate reporting, never individual support content." },
  "count": { "participant_one": "{{count}} participant", "participant_few": "{{count}} participants", "participant_other": "{{count}} participants" }
}
```
`locales/en/marketing.json` holds the handoff homepage copy verbatim (from `docs/design-handoff/index.html`, homepage view), with keys: `meta.title` "NestSelf — support for work, and everything around it", `meta.description`, `nav.findSupport` "Find support", `nav.howItWorks` "How it works", `nav.lifeBeyondWork` "Life beyond work", `nav.forEmployers` "For employers", `hero.eyebrow` "Wellbeing through your workplace", `hero.titleLine1` "Support for work.", `hero.titleLine2` "And everything around it.", `hero.lead` "Life does not fit into a job description. Find a conversation, practical advice and a clearer next step for the things on your mind.", `hero.ctaPrimary` "Explore support", `hero.ctaSecondary` "For your team", `hero.note` "Know your coverage before you confirm.", `hero.caption` "The everyday moments that make up a whole life.", `hero.altLead` "A family spending time together on the grass in a park", `hero.altFriends` "Friends talking and laughing outdoors", `hero.altCare` "Two women sharing a moment together in a living room", `support.eyebrow` "Find support", `support.title` "You do not need a perfect reason to start.", `support.lead` "A difficult week. A question you keep putting off. A decision that feels bigger on your own. Choose the kind of guidance that helps.", `support.alt` "Two friends having a conversation on a bench outdoors", `support.psychological.title` "A little space to talk", `support.psychological.body` "Psychological support for what you are carrying, at work or outside it.", `support.legal.title` "A clearer way through", `support.legal.body` "Legal guidance to understand a question and the options in front of you.", `support.financial.title` "More clarity about money", `support.financial.body` "Practical financial guidance for everyday decisions and the next step.", `how.eyebrow` "How it works", `how.title` "Your first step can be small.", `how.lead` "A clear path from choosing support to understanding what happens next.", `how.step1.title` "Start where you are.", `how.step1.body` "Choose a support area and see who can help. You do not have to work out everything first.", `how.step2.title` "See the details.", `how.step2.body` "Check the format, availability and your workplace coverage before making a choice.", `how.step3.title` "Take the next step.", `how.step3.body` "Begin a conversation or confirm an appointment, with the important details in front of you.", `life.eyebrow` "People, before job titles", `life.title` "There is a whole life around the workday.", `life.lead` "Relationships, new responsibilities, ordinary days and unexpected turns. Support should leave room for all of it.", `life.alt1` "An older adult and two children talking together on a park bench", `life.caption1` "Time with the people who matter.", `life.alt2` "Parents and a child playing outside in a park", `life.caption2` "Room for small, good moments.", `life.alt3` "A couple preparing food together in a kitchen", `life.caption3` "Life, in its everyday shape.", `employer.eyebrow` "For employers", `employer.title` "A workplace benefit with people at its centre.", `employer.body` "Bring psychological, legal and financial guidance into one understandable employee experience, with a separate space to manage the programme.", `employer.cta` "Explore the employer experience", `employer.alt` "A family together outdoors among autumn trees", `privacy.title` "Know what you share. Know who can see it.", `privacy.body` "Understand how conversations, appointments and employer reporting are separated before you share something personal.", `privacy.cta` "Read the privacy model", `privacy.dialogTitle` "How access should be separated", `privacy.dialogLead` "Your own support history, assigned professional access and the employer's programme view have different purposes.", `privacy.rows.employee` "Employee: your own conversations and appointments.", `privacy.rows.advisor` "Assigned advisor: the scope needed for your assigned case.", `privacy.rows.employer` "Employer: eligibility administration, programme budget and protected aggregate reporting, without individual support content.", `privacy.rows.exceptional` "Exceptional access: a defined, authorised and recorded operational process.", `privacy.disclaimer` "This is the proposed design model, not a live privacy notice or proof of implemented access control.", `footer.photography` "Photography direction", `footer.credits` "Photo credits", `footer.designSystem` "Design system", `credits.title` "People and photographs", `credits.lead` "Pexels lifestyle photographs used as conceptual imagery. No endorsement, customer identity, professional role or family eligibility is implied.", `credits.licence` "Pexels licence", plus `pages.support.title/lead`, `pages.employers.title/lead`, `pages.privacyModel.title/lead`, `pages.credits.title`, `notFound.title` "This page does not exist", `notFound.body`, `notFound.cta` "Back to the homepage" written in the same register (short, no promises).
`locales/en/workspace.json`, `admin.json`, `mobile.json`: every string the representative screens in Phase 3 need (home greeting `home.greeting` "Hello, {{name}}", category cards, next appointment card labels, channel feed labels, booking demo labels: `booking.step` "Step {{current}} of {{total}}", `booking.chooseAdvisor` "Choose an advisor", `booking.chooseTime` "Choose a time", `booking.review` "Review your appointment", `booking.price` "Appointment price", `booking.employerCovers` "Employer covers", `booking.youPay` "You pay", `booking.timeZone` "Time zone: {{zone}}", `booking.terms` "Change and cancellation terms", `booking.confirmPay` "Confirm and pay {{amount}}", `booking.done.title` "Example confirmed", `booking.done.body` "In the product, the confirmation would show the time, cost and cancellation details. No appointment or payment was created here.", HR overview labels (`hr.programme` "Support programme", `hr.eligible` "Eligible employees", `hr.fund` "Available fund", `hr.reserved` "Reserved", `hr.activated` "Activated accounts", `hr.teamBreakdown` "Team breakdown", `hr.protectedNote` "Protected is not the same as zero."), admin (`experts.title` "Experts", `experts.realPortraitNote` "Portraits appear only for approved experts; initials are used until then.", `organizations.title` "Organisations", table headers), mobile tab labels. Keep strings short and factual.

- [ ] **Step 3: Serbian Latin catalogs**

Write `locales/sr-Latn/*.json` with careful Serbian translations of every key (same structure). Use standard Serbian product register ("Podrška", "Termini", "Poruke", "Kanali", "Ankete", "Podešavanja", "Prostor poslodavca", "Nastavi", "Otkaži", "Potvrdi", "Sačuvaj", "Pokušaj ponovo", "Pošalji"). Plural keys: `participant_one` "{{count}} učesnik", `participant_few` "{{count}} učesnika", `participant_other` "{{count}} učesnika". Keep brand names (NestSelf, Pexels, Phosphor) in Latin script. Mark in `README.md` that these are drafts needing a native reviewer before launch.

- [ ] **Step 4: Transliteration script and generated Cyrillic**

`scripts/transliterate.mjs`: deterministic Serbian Latin → Cyrillic. Map (longest first): `Dž→Џ, dž→џ, DŽ→Џ, Lj→Љ, lj→љ, LJ→Љ, Nj→Њ, nj→њ, NJ→Њ`, then single letters `A→А B→Б V→В G→Г D→Д Đ→Ђ E→Е Ž→Ж Z→З I→И J→Ј K→К L→Л M→М N→Н O→О P→П R→Р S→С T→Т Ć→Ћ U→У F→Ф H→Х C→Ц Č→Ч Š→Ш` and lowercase. Preserve `{{placeholders}}`, text inside `<...>` tags, URLs, and the protected terms listed in `scripts/transliteration-exceptions.json` (`{ "protected": ["NestSelf", "Pexels", "Phosphor", "Onest", "Europe/Belgrade"], "wordOverrides": { "injekcija": "инјекција", "konjunktura": "конјунктура", "nadživeti": "надживети" } }`; apply `wordOverrides` on whole words, case-insensitively preserving the initial capital). Modes: default prints a diff summary; `--write` writes `locales/sr-Cyrl/*.json` from `locales/sr-Latn/*.json`; `--check` exits 1 if the committed Cyrillic differs from a fresh transliteration. Export the pure function from a sibling `scripts/transliterate-core.mjs` so it is unit-testable: tests in `src/transliterate.test.ts` cover `"Ljubljana i Njegoš"` → `"Љубљана и Његош"`, `"džem"` → `"џем"`, placeholders untouched, protected terms untouched, `"injekcija"` override.

Run: `pnpm --filter @nestself/i18n build:cyrillic` and commit the generated files.

- [ ] **Step 5: `scripts/check-locales.mjs`** — fails (exit 1) when any key present in `en` is missing in another locale or vice versa, when a value is an empty string, when a plural group is incomplete for Serbian (`_one`, `_few`, `_other`), when the committed `sr-Cyrl` is not what `transliterate.mjs --check` produces, or when a `{{placeholder}}` set differs between locales for the same key. Prints `All 5 namespaces consistent across 3 locales.` on success.

- [ ] **Step 6: Tests and index**

`src/index.ts` exports types, config, resources, format helpers, `negotiateLocale`, `parseAcceptLanguage`. `src/plural.test.ts`: create an i18next instance with `resources`, `lng: 'sr-Latn'`, assert `t('count.participant', { count: 1 })` ends with "učesnik", `{ count: 3 }` with "učesnika", `{ count: 25 }` with "učesnika" (Serbian `few` is 2–4); switch to `sr-Cyrl` and assert Cyrillic output; delete one Cyrillic key in a cloned resource and assert the Latin fallback is used. `src/negotiate.test.ts`: `['sr-Latn-RS']→'sr-Latn'`, `['sr-RS']→'sr-Latn'`, `['sr-Cyrl-RS']→'sr-Cyrl'`, `['de','en-US']→'en'`, `[]→'en'`; `parseAcceptLanguage('sr-Latn;q=0.8, en;q=0.9')` → `['en','sr-Latn']`.

Run: `pnpm --filter @nestself/i18n lint && pnpm --filter @nestself/i18n typecheck && pnpm --filter @nestself/i18n test && pnpm --filter @nestself/i18n check`
Expected: all pass; the check prints the success line.

### Task 1.5: `packages/sample-data`

**Files:** `src/index.ts`, `src/mode.ts`, `src/fixtures/{org,people,channels,polls,experts,content,booking,hr,events}.ts`, `src/sample-data.test.ts`

- [ ] **Step 1: Fixtures** — every exported object includes `sample: true as const` and fictional names only. Content:
  - `SAMPLE_ORG` `{ id: 'org_sample', name: 'Example d.o.o.', slug: 'example' }`; `SAMPLE_TEAMS` (Product, Operations, Sales).
  - `SAMPLE_PEOPLE`: six fictional users with initials and org roles (two employees, one manager, one hr_admin), one expert (platform role, specialty psychological, name "Milica Ristić", `initials: 'MR'`, `format: 'online'`, `languages: ['sr']`, `portrait: null`), one operations user. Sessions for each role as `SAMPLE_SESSIONS: Record<OrgRole | PlatformRole, Session>` built with `SessionSchema.parse`.
  - `SAMPLE_CHANNELS` (org-wide "Good news", team "Product"), `SAMPLE_POSTS` (four short posts, dates in October 2026).
  - `SAMPLE_POLLS` (one open team-building poll with three options and counts).
  - `SAMPLE_EXPERTS` (three, one per area, initials only).
  - `SAMPLE_CONTENT` (three articles with area, locale `en`, 2-sentence summaries).
  - `SAMPLE_BOOKING`: the handoff demonstration exactly: advisor Milica Ristić · online, date `2026-10-21`, slots `['10:00','16:30','17:30','18:30']`, time zone `Europe/Belgrade`, `price: 45`, `employerCovers: 35`, `youPay: 10`, `currency: 'EUR'`.
  - `SAMPLE_HR_PROGRAMME`: `eligibleEmployees: 500`, `activatedAccounts: 164`, `availableFund: 1850`, `reserved: 650`, `currency: 'EUR'`, `teamBreakdown: { protected: true, reason: 'tooSmall' }`.
  - `SAMPLE_EVENT_REQUEST`: 25 participants, Novi Sad, options bowling / karting / outdoor day, status `requested`.
- [ ] **Step 2: `src/mode.ts`** — `isSampleMode(env: Record<string, string | undefined>)`: true when `env.VITE_DATA_SOURCE === 'sample' || env.EXPO_PUBLIC_DATA_SOURCE === 'sample'`; `assertNotProduction(env)` throws when `env.NODE_ENV === 'production'` (used by the API seed).
- [ ] **Step 3: Tests** — every fixture has `sample === true`; no fixture object has a `portrait` or `photo` value other than `null`; `SAMPLE_SESSIONS.hr_admin.orgRole === 'hr_admin'`; `isSampleMode({ VITE_DATA_SOURCE: 'sample' })` true, `{}` false; `assertNotProduction({ NODE_ENV: 'production' })` throws.

### Task 1.6: `packages/api-client`

**Files:** `src/client.ts`, `src/errors.ts`, `src/queries/health.ts`, `src/index.ts`, `src/client.test.ts`

- [ ] **Step 1: Client**
```ts
// src/client.ts
import type { z } from 'zod';
import { ApiError } from './errors';
export interface ApiClientOptions { baseUrl: string; getToken?: () => string | null | Promise<string | null>; fetchImpl?: typeof fetch }
export interface ApiClient { request<T>(path: string, init: RequestInit & { schema: z.ZodType<T> }): Promise<T>; baseUrl: string }
export function createApiClient(opts: ApiClientOptions): ApiClient
```
`request` builds `${baseUrl}${path}`, sets `Accept: application/json`, adds `Authorization: Bearer <token>` when a token exists, throws `ApiError { status, code, message, requestId }` on non-2xx (parsing `{ message }` or `{ error }` bodies, reading the `x-request-id` header), parses JSON and validates with `schema.parse`, rethrowing validation failures as `ApiError` with `code: 'invalid_response'`. Network failures become `ApiError` with `status: 0, code: 'network'` (this is what the offline `StatusBlock` keys on).

`src/queries/health.ts`:
```ts
import { queryOptions } from '@tanstack/react-query';
import { HealthResponseSchema } from '@nestself/contracts';
import type { ApiClient } from '../client';
export const healthQueryOptions = (client: ApiClient) => queryOptions({ queryKey: ['health'], queryFn: () => client.request('/api/health', { schema: HealthResponseSchema }), staleTime: 30_000, retry: 1 });
```
- [ ] **Step 2: Tests** with `fetchImpl` stubbed: 200 + valid body resolves; 503 with `{ status: 'error' }` rejects with `ApiError.status === 503`; invalid body rejects with `code 'invalid_response'`; a rejected fetch gives `code 'network'`; the bearer header is sent when `getToken` returns a value.

Barrier after Phase 1 (orchestrator): `pnpm install` is NOT needed unless a task reported missing dependencies; run `pnpm lint && pnpm typecheck && pnpm test && pnpm check`; commit `feat: tokens, assets, contracts, i18n, sample data, api client`.

---

## Phase 2 — UI libraries

Phase 2a runs two workers in parallel: **Task 2.1 (ui foundation, actions, fields)** and **Task 2.4 (ui-native)**. Phase 2b runs two workers in parallel after 2.1: **Task 2.2 (ui feedback, navigation, dialogs, tables)** and **Task 2.3 (ui patterns)**. Within `packages/ui`, each task owns only its own component folders; shared files are created in 2.1 and not edited afterwards.

### Shared conventions for `packages/ui`

- Layout: `src/components/<group>/<component>/{<component>.tsx,<component>.test.tsx,<component>.stories.tsx,index.ts}`, group barrels `src/components/<group>/index.ts`, root barrel `src/index.ts`. Groups: `foundation`, `actions`, `fields`, `feedback`, `navigation`, `dialogs`, `tables`, `patterns`.
- Styling: Tailwind utilities that map to semantic tokens through `@nestself/tokens/tailwind.css`. Base UI parts receive `className` (string or `(state) => string`); state styling uses the `data-*` custom variants defined in `styles.css` (`data-disabled:`, `data-invalid:`, `data-checked:`, `data-open:`, `data-highlighted:`, `data-pressed:`, `data-selected:`). Explicit props for `variant`, `size` (`md` | `sm`), `density` (`comfortable` | `compact`) where the handoff defines them. Every interactive element has `focus-visible:outline-[3px] focus-visible:outline-focus focus-visible:outline-offset-2` and the documented minimum size (`min-h-11` web, `pointer-coarse:min-h-12`). Loading states keep the label and dimensions and block repeat activation. Min-height, never fixed height, on text containers.
- `cn()` from `src/lib/cn.ts`: `clsx` + `tailwind-merge` configured with `extendTailwindMerge({ extend: { classGroups: { 'font-size': [{ 'type': ['display','editorial','screen-title','section-title','body-large','body','label','metadata','table','marketing-hero'] }] } } })` so a `type-*` role replaces another.
- Accessibility: Base UI handles roles, keyboard and focus; components add labels, descriptions and live regions. Icons rendered inside buttons are `aria-hidden`; icon-only buttons require `aria-label`.
- Tests: Vitest + Testing Library + user-event in jsdom; a11y via `expectNoA11yViolations(container)` from `src/test/axe.ts` (runs `axe.run` from `axe-core` with the `wcag2a`, `wcag2aa`, `wcag22aa` tags and asserts an empty `violations` array with a readable message). Focus containment of dialogs is verified by Playwright later; jsdom tests cover return focus and `aria-modal`.
- Stories: one `*.stories.tsx` per component using CSF3; `tags: ['autodocs']`; a `States` story that lays out every required state the handoff lists (default, hover, pressed, focus-visible, selected, disabled, read-only, loading, invalid, success) using explicit demo props where pseudo-states cannot be forced; `Sizes` and `Density` stories where variants exist.

### Task 2.1: `packages/ui` foundation, actions, fields, Storybook, test harness

**Files (create):** `src/styles.css`, `src/typography.css`, `src/lib/cn.ts`, `src/lib/cn.test.ts`, `src/test/axe.ts`, `src/test/index.ts`, `src/test/setup.ts`, `src/index.ts`, group barrels (`feedback`, `navigation`, `dialogs`, `tables`, `patterns` as `export {};` placeholders), `.storybook/main.ts`, `.storybook/preview.tsx`, `.storybook/storybook.css`, and the components below.

- [ ] **Step 1: `src/styles.css`** (no `@import "tailwindcss"` here; apps and Storybook import Tailwind first, then this file)

```css
/* @nestself/ui — tokens, theme bridge, fonts, Base UI variants, base styles, type roles. */
@import "@nestself/tokens/tokens.css";
@import "@nestself/tokens/tailwind.css";
@import "@nestself/assets/fonts.css";
@import "./typography.css";

@custom-variant data-open (&[data-open]);
@custom-variant data-closed (&[data-closed]);
@custom-variant data-checked (&[data-checked]);
@custom-variant data-unchecked (&[data-unchecked]);
@custom-variant data-indeterminate (&[data-indeterminate]);
@custom-variant data-disabled (&[data-disabled]);
@custom-variant data-readonly (&[data-readonly]);
@custom-variant data-invalid (&[data-invalid]);
@custom-variant data-valid (&[data-valid]);
@custom-variant data-highlighted (&[data-highlighted]);
@custom-variant data-pressed (&[data-pressed]);
@custom-variant data-selected (&[data-selected]);
@custom-variant data-active (&[data-active]);
@custom-variant data-starting-style (&[data-starting-style]);
@custom-variant data-ending-style (&[data-ending-style]);
@custom-variant pointer-coarse (@media (pointer: coarse));

@layer base {
  *, *::before, *::after { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; position: relative; background: var(--color-canvas); color: var(--color-text); font: var(--font-weight-body) 1rem/1.5 var(--font-body); -webkit-font-smoothing: antialiased; }
  #root, #__next, [data-app-root] { isolation: isolate; }
  [hidden] { display: none !important; }
  button, input, select, textarea { font: inherit; }
  button { cursor: pointer; }
  button:disabled { cursor: not-allowed; }
  a { color: var(--color-primary); text-underline-offset: 0.2em; }
  img { display: block; max-width: 100%; height: auto; }
  h1, h2, h3, h4, p, figure { margin: 0; }
  h1, h2, h3, h4 { font-family: var(--font-heading); font-weight: var(--font-weight-label); line-height: 1.18; }
  :where(a, button, input, select, textarea, summary, [tabindex]):focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; }
  ::selection { background: var(--color-accent); color: var(--color-on-accent); }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0ms !important; }
  }
}
```

- [ ] **Step 2: `src/typography.css`** — Tailwind `@utility` per type role, values from `tokens.json.typography.styles` (web / mobileWeb), rem-based, with `font-variant-numeric: lining-nums tabular-nums` on `type-table`:

```css
@utility type-display { font-size: clamp(2.5rem, 1.5rem + 2.5vw, 3.5rem); line-height: 1.15; font-weight: var(--font-weight-label); letter-spacing: -0.02em; }
@utility type-marketing-hero { font-size: clamp(2.5rem, 5cqi, 4rem); line-height: 1.1; font-weight: var(--font-weight-label); letter-spacing: -0.035em; }
@utility type-editorial { font-size: clamp(2rem, 1.5rem + 1.2vw, 2.5rem); line-height: 1.2; font-weight: var(--font-weight-label); }
@utility type-screen-title { font-size: clamp(1.75rem, 1.5rem + 0.6vw, 2rem); line-height: 1.25; font-weight: var(--font-weight-label); }
@utility type-section-title { font-size: clamp(1.375rem, 1.3rem + 0.3vw, 1.5rem); line-height: 1.33; font-weight: var(--font-weight-label); }
@utility type-body-large { font-size: 1.125rem; line-height: 1.56; font-weight: var(--font-weight-body); }
@utility type-body { font-size: 1rem; line-height: 1.5; font-weight: var(--font-weight-body); }
@utility type-label { font-size: 1rem; line-height: 1.5; font-weight: var(--font-weight-label); }
@utility type-metadata { font-size: 0.875rem; line-height: 1.43; font-weight: var(--font-weight-body); }
@utility type-table { font-size: 0.875rem; line-height: 1.43; font-variant-numeric: lining-nums tabular-nums; }
@utility reading-width { max-width: var(--reading-width); }
```

- [ ] **Step 3: Test harness and Storybook**

`src/test/axe.ts`:
```ts
import axe from 'axe-core';
export async function expectNoA11yViolations(container: Element) {
  const results = await axe.run(container, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag22aa'] } });
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join('; ')})`).join('\n');
  if (results.violations.length) throw new Error(`axe violations:\n${summary}`);
}
```
`src/test/index.ts` re-exports it plus `renderWithTheme` (wraps in `ThemeProvider`). `src/test/setup.ts` imports jest-dom and polyfills `window.matchMedia`, `ResizeObserver`, `Element.prototype.scrollIntoView` and `HTMLDialogElement.prototype.showModal/close` for jsdom.

`.storybook/main.ts`:
```ts
import type { StorybookConfig } from '@storybook/react-vite';
const config: StorybookConfig = { stories: ['../src/**/*.stories.@(ts|tsx)'], addons: ['@storybook/addon-a11y'], framework: { name: '@storybook/react-vite', options: {} } };
export default config;
```
`.storybook/storybook.css`: `@import "tailwindcss"; @import "../src/styles.css"; @source "../src";`
`.storybook/preview.tsx`: imports `storybook.css`; `globalTypes` toolbars for palette (`forest, ink, plum, azure`), mode (`light, dark`), font (`onest, commissioner, nunito, fira, lato`) with `initialGlobals` forest/light/onest; a decorator that calls `applyTheme({ palette, mode, font })` from `@nestself/tokens/theme` and wraps the story in `<div data-app-root className="bg-canvas text-text p-6">`; `parameters.a11y = { test: 'error' }`.

- [ ] **Step 4: Foundation components**

`foundation/theme`: `ThemeProvider({ initial?, storage?, children })` keeps `ThemeSelection` in state, applies it to `<html>` with `applyTheme`, persists with `persistTheme`; `useTheme()` returns `{ theme, setPalette, setMode, setFont, toggleMode }`; `ThemeStudio({ enabled })` renders nothing when `enabled` is false, otherwise a fixed bottom-right `<details>` panel (z `var(--z-sticky)`) with three native `<select>`s labelled through props `labels` (apps pass translated labels) and a visually hidden heading. Tests: provider applies attributes; `ThemeStudio enabled={false}` renders nothing; selecting a palette updates `data-palette`.

`foundation/icon`: `Icon({ icon: PhosphorIcon, weight?: 'regular' | 'fill' | 'duotone' | 'bold', size?: 16 | 20 | 24 | 32 | 48, label?: string })` — when `label` is absent renders `aria-hidden`, otherwise `role="img"` with `aria-label`; `CategoryIcon({ category: IconCategory, size?: 32 | 48 })` maps `iconMapping` (`mentalSupport → Heart`, `legal → Scales`, `financial → Wallet`, `teamEvents → UsersThree`, `conversation → ChatCircleText`, `appointment → CalendarCheck`, `privacy → LockKey`, `content → Books`) and always uses `weight="duotone"`; `NavIcon({ icon, active })` uses `fill` when active, `regular` otherwise. Test: `CategoryIcon category="legal"` renders an svg with duotone paths (the Phosphor duotone variant renders an element with `opacity="0.2"`); `NavIcon active` switches weight.

`foundation/typography`: `Heading({ level: 1|2|3|4, role?: TypeRole, children })` and `Text({ as?, role?: 'bodyLarge'|'body'|'label'|'metadata'|'table', tone?: 'default'|'secondary'|'danger', children })` mapping roles to the `type-*` utilities. `Eyebrow` (handoff `.eyebrow`: primary colour, label weight, 0.875rem, optional `numbered` uppercase variant).

`foundation/visually-hidden` (`VisuallyHidden`) and `foundation/live-region` (`LiveRegion({ politeness: 'polite' | 'assertive', children })` rendering `role="status"`/`role="alert"` with `aria-live`; plus `useAnnounce()` returning `announce(message)` backed by a single provider-level live region `AnnouncerProvider`).

`foundation/skip-link`: `SkipLink({ href = '#main', children })` — handoff `.skip` behaviour (fixed, off-screen until focused).

- [ ] **Step 5: Actions**

`actions/button` — the full exemplar for every later component:

```tsx
import { Button as BaseButton } from '@base-ui/react/button';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'on-brand';
export type ButtonSize = 'md' | 'sm';
export interface ButtonProps extends Omit<ComponentPropsWithoutRef<typeof BaseButton>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Keeps label and dimensions, announces busy, blocks repeat activation. */
  loading?: boolean;
  loadingLabel?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
  className?: string;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-pressed data-pressed:bg-primary-pressed',
  secondary: 'border-border-control bg-surface text-primary hover:bg-tint active:bg-tint',
  ghost: 'border-transparent bg-transparent text-primary hover:bg-tint active:bg-tint px-2',
  danger: 'border-transparent bg-danger text-surface hover:brightness-95 dark:text-danger-surface',
  'on-brand': 'border-transparent bg-on-primary text-primary hover:bg-accent hover:text-on-accent',
};
const sizeClasses: Record<ButtonSize, string> = {
  md: 'min-h-11 px-5 py-2.5 text-base pointer-coarse:min-h-12',
  sm: 'min-h-11 px-4 py-2 text-sm pointer-coarse:min-h-12',
};

export function Button({ variant = 'primary', size = 'md', loading = false, loadingLabel, leadingIcon, trailingIcon, fullWidth, className, children, disabled, onClick, ...rest }: ButtonProps) {
  return (
    <BaseButton
      {...rest}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={(event) => { if (loading) { event.preventDefault(); return; } onClick?.(event); }}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control border font-[var(--font-weight-label)] leading-normal no-underline transition-[background-color,border-color,color] duration-[var(--motion-fast)] ease-standard',
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        'data-disabled:border-transparent data-disabled:bg-disabled-surface data-disabled:text-disabled-text',
        variantClasses[variant], sizeClasses[size], fullWidth && 'w-full', loading && 'relative', className,
      )}
    >
      {leadingIcon ? <span aria-hidden className="inline-flex shrink-0">{leadingIcon}</span> : null}
      <span className={cn(loading && 'opacity-70')}>{children}</span>
      {loading ? <span className="sr-only" role="status">{loadingLabel ?? 'Loading'}</span> : null}
      {trailingIcon ? <span aria-hidden className="inline-flex shrink-0">{trailingIcon}</span> : null}
    </BaseButton>
  );
}
```
Note the `dark:` variant must not be used anywhere (mode is a data attribute, not a media query): replace `dark:text-danger-surface` with a `data-mode` aware rule in `styles.css`: `html[data-mode="dark"] .btn-danger { color: var(--color-danger-surface); }` and add `btn-danger` to the danger variant. Tests `button.test.tsx`: Enter and Space activate; `loading` blocks `onClick` and sets `aria-busy`; label text remains in the DOM while loading; `disabled` sets `data-disabled` and blocks click; `expectNoA11yViolations`; each variant renders (snapshot of class string not required). Stories: `Variants`, `Sizes`, `States` (default, hover via `className="bg-primary-hover"` demo, pressed via `data-pressed` demo prop, focus-visible via `className="outline-[3px] outline-focus outline-offset-2"` demo, disabled, loading).

`actions/icon-button`: `IconButton({ label (required), icon, variant?, size? })` — square `min-h-11 min-w-11`, `aria-label`, icon `aria-hidden`. Test: accessible name equals `label`.
`actions/text-link`: `TextLink({ href, trailingArrow?, children })` and `LinkButton` (Button rendered as an anchor via Base UI `render={<a href />}`) for calls to action. Test: renders an anchor with the href and keeps button styles.

- [ ] **Step 6: Fields**

`fields/field`: built on `@base-ui/react/field` — `Field({ label, description?, error?, required?, optionalLabel?, children, id? })` renders `Field.Root` with `Field.Label`, the control, `Field.Description` and `Field.Error` wired by Base UI (`aria-describedby`, `aria-invalid`, `data-invalid`); `Input` (`Field.Control` as input, `min-h-12 px-3 rounded-control border border-border-control bg-surface text-text placeholder:text-text-secondary data-invalid:border-2 data-invalid:border-danger data-disabled:bg-tint data-disabled:text-text-secondary`, `density="compact"` → `min-h-11` for HR tables only), `Textarea` (`min-h-24 resize-y`), `Select` (Base UI `@base-ui/react/select`: Trigger styled like Input with a `CaretDown` icon, Popup with `shadow-menu rounded-control bg-surface z-[var(--z-dropdown)]`, items `data-highlighted:bg-tint data-selected:font-[var(--font-weight-label)]`). Tests: error text is referenced by `aria-describedby` and sets `aria-invalid="true"`; required adds the indicator and `aria-required`; `Select` opens with keyboard (ArrowDown), selects with Enter and exposes the chosen value; axe clean.
`fields/checkbox`, `fields/radio-group` (`@base-ui/react/checkbox`, `@base-ui/react/radio`): 18 px indicator (`size-[1.125rem]`), 48 px row (`min-h-12`), `accent` via `data-checked:bg-primary data-checked:border-primary`; `CheckboxGroup` with legend. Tests: Space toggles, `data-checked` reflects state, group has an accessible name.
`fields/switch` (`@base-ui/react/switch`): track `w-10 h-6 rounded-pill bg-border-control data-checked:bg-primary`, thumb `size-[1.2rem] bg-surface transition-transform duration-[var(--motion-standard)] data-checked:translate-x-4`; label on the left as in the handoff. Test: exposes `role="switch"` with `aria-checked` toggling on click and Space.
`fields/chip`: `Chip({ pressed, onPressedChange, children, icon? })` as a toggle button (`aria-pressed`), `min-h-11 rounded-control border border-border-control bg-surface text-text aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-on-primary`; `ChipGroup({ label, children })` with `role="group"`. Tests: toggles `aria-pressed`; group labelled.
`fields/fieldset`: `Fieldset({ legend, description?, children })` with Base UI `@base-ui/react/fieldset`.
`fields/form-error-summary`: `FormErrorSummary({ title, errors: { id, label, message }[] })` renders `role="alert"`, `tabIndex={-1}`, a heading and a list of links `href="#<id>"` whose click focuses the field; exposes `ref` so forms can call `focus()` after a failed submit. Test: rendering with errors moves focus when `focus()` is called; link click focuses the input with that id.

- [ ] **Step 7: Barrels and verification**

`src/components/foundation/index.ts`, `actions/index.ts`, `fields/index.ts` export everything; `src/index.ts`:
```ts
export * from './components/foundation';
export * from './components/actions';
export * from './components/fields';
export * from './components/feedback';
export * from './components/navigation';
export * from './components/dialogs';
export * from './components/tables';
export * from './components/patterns';
export { cn } from './lib/cn';
```
with the five not-yet-built groups holding `export {};`.

Run: `pnpm --filter @nestself/ui lint && pnpm --filter @nestself/ui typecheck && pnpm --filter @nestself/ui test`
Expected: PASS. Run: `pnpm --filter @nestself/ui storybook:build 2>&1 | tail -5` — Expected: `storybook-static` produced without errors (warnings about missing stories for the empty groups are fine).

### Task 2.2: `packages/ui` feedback, navigation, dialogs, tables

Owns `src/components/{feedback,navigation,dialogs,tables}/**` only. Uses Task 2.1 primitives.

- [ ] **Feedback:** `Alert({ tone: 'info'|'success'|'warning'|'danger', title?, children, icon? })` (handoff `.alert`: `flex gap-3 p-4 rounded-control`, tone → `text-info bg-info-surface` etc., `role="status"` for info/success and `role="alert"` for warning/danger); `Badge({ tone: 'neutral'|'success'|'warning'|'danger'|'info' })` (pill, `min-h-7`, label weight); `Toast` on `@base-ui/react/toast` (`ToastProvider`, `useToast().add({ title, description?, tone? })`, viewport fixed bottom-centre `z-[var(--z-toast)]`, `bg-primary text-on-primary shadow-menu rounded-control`, auto-dismiss 6 s, pauses on hover/focus, `aria-live` handled by Base UI); `Skeleton({ lines = 3, label })` (`aria-hidden` bars + visually hidden label, respects reduced motion by not animating); `StatusBlock({ state: 'empty'|'results'|'loading'|'offline'|'stale'|'permission'|'expired'|'protected', title, body, action?: { label, onClick } , icon? })` (handoff `.status-block`: centred, `bg-canvas rounded-card p-8`, default icon per state from Phosphor regular: `CalendarCheck`, `MagnifyingGlass`, none+Skeleton, `WarningCircle`, `Clock`, `LockKey`, `ShieldCheck`, `LockKey`; `loading` renders `Skeleton` and `aria-busy`; `offline`/`stale` render the action as `secondary` button; copy comes from props so apps pass translations). Tests: tones map to roles; toast appears and can be dismissed with Escape; `StatusBlock state="protected"` shows title and the action; `loading` has `aria-busy`.
- [ ] **Navigation:** `SiteHeader({ brand: { label, href }, links: { label, href, current? }[], actions?, menuLabel, closeLabel })` — desktop inline links, below 760 px (container query on the header's wrapper, `@container`) a `Menu` button with `aria-expanded`/`aria-controls` toggling a vertical list; `AppShell({ sidebar, topbar, bottomBar, children })` — grid with `Sidebar` 248 px (`w-[15.5rem]`) hidden below 1024 px, `Topbar` `min-h-[4.5rem]`, `BottomBar` `min-h-16 pb-[env(safe-area-inset-bottom)]` shown below 1024 px with up to five `NavItem`s, `<main id="main" tabIndex={-1}>` with the content max width prop (`'employee' | 'hr' | 'form'` → `max-w-employee` etc.); `NavItem({ href, icon, label, active, render? })` uses `NavIcon` (fill when active), `aria-current="page"` when active, `min-h-12`; `Tabs` (`@base-ui/react/tabs`: list with `border-b border-border-subtle`, tab `min-h-11 data-selected:text-primary data-selected:border-b-2 data-selected:border-primary`); `Menu` (`@base-ui/react/menu`: trigger, popup `shadow-menu rounded-control bg-surface z-[var(--z-dropdown)] p-1`, item `min-h-11 rounded-small data-highlighted:bg-tint`). Tests: `SiteHeader` menu toggles `aria-expanded` and the list visibility; `NavItem active` has `aria-current="page"` and a `fill` icon; `Tabs` arrow keys move selection; `Menu` opens with Enter and closes with Escape returning focus to the trigger.
- [ ] **Dialogs:** `Dialog` on `@base-ui/react/dialog` (`Dialog.Root/Trigger/Portal/Backdrop/Popup/Title/Description/Close`): backdrop `bg-scrim z-[var(--z-scrim)]`, popup `fixed inset-0 m-auto h-fit w-[min(calc(100%-2rem),37rem)] max-h-[min(85vh,52rem)] overflow-auto rounded-modal border border-border-subtle bg-surface p-8 pointer-coarse:p-6 shadow-modal z-[var(--z-dialog)]`, close `IconButton` top-right 44 px, actions row `flex flex-wrap justify-end gap-3 mt-7`; `AlertDialog` on `@base-ui/react/alert-dialog` with `confirmLabel`, `cancelLabel`, `destructive?` (danger button) — used by the "Cancel this appointment?" demonstration; `Sheet` = Dialog variant anchored to the bottom (`rounded-t-sheet`, `p-6`, `pb-[max(1.5rem,env(safe-area-inset-bottom))]`) for touch flows. Tests: opening moves focus into the popup and the popup has `aria-modal="true"`; Escape closes and focus returns to the trigger; `AlertDialog` confirm calls the handler once; axe clean.
- [ ] **Tables:** `Table({ caption, density: 'default' | 'compact', children })` wrapped in `.table-scroll` (`overflow-x-auto rounded-card border border-border-subtle bg-surface`) with `<table class="w-full type-table">`, `Th`/`Td` (`h-14 px-4 py-3` default, `h-11` compact), `numeric` prop → `text-right tabular-nums whitespace-nowrap`, `compact` forbidden on coarse pointers (component forces default under `pointer: coarse` via the `pointer-coarse:` variant); `DataList({ items: { term, description, numeric? }[] , total? })` (handoff `.cost-list` layout: rows `flex justify-between py-2`, last row separated and label weight); `MetricCard({ label, value, hint? })` (handoff `.hr-metrics`: label metadata secondary, value `text-[1.65rem] font-[var(--font-weight-label)] text-primary tabular-nums`); `ProtectedValue({ label, reason, totalAction? })` renders the word given in `label` (apps pass "Protected") with a `LockKey` icon and `aria-describedby` reason, never a number. Tests: compact density applies `h-11` and default applies `h-14`; numeric cells align right; `ProtectedValue` never renders digits and exposes the reason.
- [ ] Group barrels replaced with real exports. Run lint/typecheck/test for the package; stories for every component.

### Task 2.3: `packages/ui` patterns

Owns `src/components/patterns/**`.

- [ ] `CostBreakdown({ rows: { price, employerCovers, youPay }, currency, locale, formatCurrency, labels: { price, employerCovers, youPay, timeZone, terms }, timeZone, onTermsClick })` — renders a `DataList` with three rows (the last emphasised), the time zone line, and a `TextLink`/ghost `Button` to the change and cancellation terms. **Price clarity test** (`cost-breakdown.test.tsx`): renders all three amounts formatted, the time zone text, and the terms control; the formatted `youPay` equals `formatCurrency(price - employerCovers)` when the prop is consistent; it throws in development when `price !== employerCovers + youPay` (guard against inconsistent splits).
- [ ] `ConfirmLabel({ action, amount })` helper used by booking flows so the confirm button always includes the amount (`"Confirm and pay €10.00"`); test asserts the amount is in the accessible name.
- [ ] `TimeSlotGrid({ slots: { id, label, available }[], selectedId, onSelect, timeZoneLabel })` — two-column grid of `Chip`s (`justify-center min-h-12`), `role="radiogroup"` semantics via `aria-pressed` chips plus a visually hidden legend; test: selecting a slot sets `aria-pressed` on one chip only; unavailable slots are disabled.
- [ ] `CoverageNotice({ children })` — handoff "Know your coverage before you confirm." row with `ShieldCheck` icon, `type-metadata text-text-secondary`.
- [ ] `PrivacyAtPointOfUse({ question, explanation, learnMoreLabel?, onLearnMore? })` — `<details>` with the question as summary (`min-h-11`), placed next to sensitive inputs; test: summary toggles the explanation.
- [ ] `ChatThread({ messages: { id, author: 'me' | 'them', text, state? }[], labels })` and `ChatComposer({ value, onChange, onSend, draftState: 'idle' | 'sending' | 'failed', labels: { message, send, retry, failedNotice, sentNotice } })` — handoff behaviour: on failure the draft stays in the input (read-only), the status text explains it, a `Retry` button receives focus; on retry success the input clears and focus returns to it; no duplicate bubble is appended until the send resolves. Tests: failing send keeps the value and shows the retry button with focus; retry success clears the input; the message list length does not change on failure.
- [ ] `EventRequestSummary({ request: { participants, location, dates, budget, options: string[], workflow: string[] }, labels })` — the HR "Team experiences" table from the handoff (`Table` with Request field / Example / Required comparison). Test: renders the four rows.
- [ ] `PhotoFigure({ photo: PhotoKey, alt, role?: ImageRole, sizes, priority?, caption?, credit?: { author, href }, className })` — renders `<picture>` with AVIF and WebP `source`s and a JPEG `img` built from `@nestself/assets` (`srcSet`, `cropPath`), explicit `width`/`height` from `photoByKey` or the crop spec, `loading="lazy"` unless `priority` (then `fetchPriority="high"` and `loading="eager"`), `decoding="async"`, `style={{ objectPosition: focalObjectPosition(photo) }}`, `object-cover`, optional `<figcaption>`. `alt=""` only when `decorative` is passed explicitly. Tests: `priority` sets `fetchpriority="high"`; sources carry `type="image/avif"` and `type="image/webp"`; width/height present; `objectPosition` equals the focal point; a decorative figure has empty alt and `aria-hidden` caption-less.
- [ ] `Avatar({ initials, name, size: 'sm' | 'md' | 'lg', src? })` — circle only for `sm`, rounded-card otherwise (handoff: circle for small avatars only), `bg-accent text-on-accent` initials; `src` renders an image with `alt={name}`; the component never fabricates a portrait. Test: initials fallback when `src` is absent.
- [ ] `SampleDataBanner({ message })` — `role="note"`, `bg-warning-surface text-warning`, sticky top, `min-h-11`, with a `WarningCircle` icon; test: renders the message.
- [ ] `BookingDemo({ advisor, slots, pricing, timeZone, labels, formatCurrency, onAnnounce })` — composes the three steps from the handoff phone demo (advisor card with initials `Avatar`, `TimeSlotGrid`, review with `CostBreakdown`, `AlertDialog` for terms, confirm `Button` with `ConfirmLabel`, done `StatusBlock`-like panel stating nothing was created) with step headings receiving focus on change (`tabIndex -1` + `focus({ preventScroll: true })`), `Step n of 3` label, and a reset. Tests: cannot continue without a slot; confirm button text includes the amount; completing announces `labels.doneAnnouncement` through `onAnnounce`; reset returns to step 1.

### Task 2.4: `packages/ui-native`

**Files:** `src/theme/{ThemeProvider.tsx,useTheme.ts,types.ts}`, `src/lib/{typography.ts,spacing.ts,typography.test.ts,spacing.test.ts}`, `src/components/{Screen,Text,Button,Field,Card,ListRow,Badge,Alert,StatusBlock,Avatar,Icon,CostBreakdown,Divider}.tsx`, `src/index.ts`, `README.md`

- [ ] `ThemeProvider({ initial?: ThemeSelection, onChange?, children })` holds `{ palette, mode }` (font is Onest only on native in this pass), exposes `useTheme()` → `{ colors: NativeColors, mode, palette, setMode, setPalette, space, radius, type: nativeType[platform] }` using `Platform.OS` to pick ios/android type scale; `useReducedMotion()` via `AccessibilityInfo`.
- [ ] `Text({ role?: TypeRole, tone?: 'default'|'secondary'|'danger'|'onPrimary', children, ...TextProps })` applies the role's fontSize/lineHeight/weight with `fontFamily` `Onest-Regular`/`Onest-SemiBold`/`Onest-Bold` by weight, `allowFontScaling` default true, `maxFontSizeMultiplier` 2 (no fixed heights anywhere; containers grow); never sets `fontStyle: 'italic'`.
- [ ] `Button({ variant: 'primary'|'secondary'|'ghost'|'danger', size: 'md', loading, disabled, label, onPress, icon? })` — `Pressable` with `minHeight: 48`, `paddingHorizontal: 20`, radius control, `accessibilityRole="button"`, `accessibilityState={{ disabled, busy }}`, pressed style uses `primaryPressed`; `Field({ label, helper, error, children })` + `Input` (`minHeight: 48`, `paddingHorizontal: 12`, border `borderControl`, error `borderWidth: 2` `danger`, `accessibilityLabel` from label, helper/error announced through `accessibilityHint`); `Card`, `ListRow` (`minHeight: 64`, `paddingHorizontal: 16`), `Badge`, `Alert`, `StatusBlock` (same eight states), `Avatar` (initials), `Icon({ icon, weight, size })` over `phosphor-react-native`, `CategoryIcon`, `CostBreakdown` (three rows, last emphasised, tabular numbers via `fontVariant: ['tabular-nums']`), `Divider`, `Screen` (safe-area padding, canvas background).
- [ ] Pure helper tests (node): `typeStyle('body', 'ios')` returns size 17/line 25 weight 400 family `Onest-Regular`; `typeStyle('label','android')` family `Onest-SemiBold`; spacing helper returns token numbers; `resolveTone(colors, 'secondary')` returns `textSecondary`.
- [ ] `README.md`: how the theme maps to tokens, the no-italic rule, the font loading contract (`expo-font` with the TTF names), and the evaluated upgrade path (Uniwind 1.13 for Tailwind v4 on native; NativeWind 4 is Tailwind v3 only).

Barrier after Phase 2 (orchestrator): `pnpm lint && pnpm typecheck && pnpm test && pnpm check && pnpm --filter @nestself/ui storybook:build`; commit `feat: web and native UI libraries`.

---

## Phase 3 — Apps (five parallel workers)

Each task owns one `apps/<name>` directory. All depend on Phases 1 and 2 being merged. Representative screens use `@nestself/sample-data` and show `SampleDataBanner` when `isSampleMode(import.meta.env)` (or `process.env` on Expo) is true; `.env.local` files are not committed, so document `VITE_DATA_SOURCE=sample` in the app README and default to sample mode when the variable is unset in development (`import.meta.env.DEV`).

### Task 3.1: `apps/marketing` — Next.js, image-led public site

**Files:** `next.config.ts`, `postcss.config.mjs`, `proxy.ts`, `src/app/globals.css`, `src/app/layout.tsx` (root passthrough), `src/app/[locale]/layout.tsx`, `src/app/[locale]/page.tsx`, `src/app/[locale]/support/page.tsx`, `src/app/[locale]/employers/page.tsx`, `src/app/[locale]/privacy-model/page.tsx`, `src/app/[locale]/credits/page.tsx`, `src/app/[locale]/not-found.tsx`, `src/app/robots.ts`, `src/app/sitemap.ts`, `src/i18n/server.ts`, `src/i18n/client.tsx`, `src/i18n/metadata.ts`, `src/components/{site-chrome.tsx,home/*.tsx,privacy-dialog.tsx,credits-dialog.tsx,dev-theme-studio.tsx}`, `src/lib/site.ts`, `public/favicon.svg`, `README.md`, tests `src/i18n/metadata.test.ts`.

- [ ] **Step 1: Config**

`next.config.ts`:
```ts
import type { NextConfig } from 'next';
const config: NextConfig = {
  reactStrictMode: true,
  images: { formats: ['image/avif', 'image/webp'] },
  experimental: { typedRoutes: true },
};
export default config;
```
`proxy.ts` (Next 16 replaces `middleware.ts`): for requests whose first path segment is not a supported locale and that are not `_next`, `api`, `images`, files with an extension, `robots.txt` or `sitemap.xml`: negotiate from the `NEXT_LOCALE` cookie then `Accept-Language` with `negotiateLocale(parseAcceptLanguage(header))` from `@nestself/i18n`, and redirect to `/${locale}${pathname}`. Export `config = { matcher: ['/((?!_next|api|images|.*\\..*).*)'] }`. If Next 16.4.2 rejects `proxy.ts` at build time, rename it to `middleware.ts` and note the deviation.

`src/app/globals.css`:
```css
@import "tailwindcss";
@import "@nestself/ui/styles.css";
@source "../../../../packages/ui/src";
```
`src/app/layout.tsx`: root layout that only returns `children` (the `[locale]` layout owns `<html>`).

- [ ] **Step 2: i18n wiring**

`src/i18n/server.ts`: `getServerT(locale, ns = ['common','marketing'])` creates an i18next instance per request with `createInstance().use(initReactI18next).init({ ...i18nBaseOptions, lng: locale, resources, ns })` (resources from `@nestself/i18n`), returns `{ t, i18n }`; cached per request with `React.cache`. `src/i18n/client.tsx`: `'use client'` `I18nProvider({ locale, children })` creating a client instance once with the same resources and `I18nextProvider`. `src/i18n/metadata.ts`: `localeAlternates(pathname)` → `{ canonical, languages: { en, 'sr-Latn', 'sr-Cyrl', 'x-default' } }` built from `NEXT_PUBLIC_SITE_URL`; `localizedMetadata({ locale, title, description, pathname })`. Test: alternates contain all three locales with correct paths and `x-default` = English.

`src/app/[locale]/layout.tsx`: `generateStaticParams` returns the three locales; `generateMetadata` uses `localizedMetadata`; validates `params.locale` with `isLocale` else `notFound()`; renders `<html lang={localeMeta[locale].htmlLang} data-palette="forest" data-mode="light" data-font="onest">` with the theme boot script inline in `<head>` (`dangerouslySetInnerHTML={{ __html: themeBootScript() }}`), `<body>` with `data-app-root`, `SkipLink`, `I18nProvider`, `AnnouncerProvider`, `ThemeProvider`, the site chrome, and `DevThemeStudio` (renders `ThemeStudio enabled={process.env.NODE_ENV !== 'production'}`). Note: `params` is a Promise in Next 16; `await props.params`.

- [ ] **Step 3: Home composition (`src/app/[locale]/page.tsx` + `src/components/home/*`)**

Reproduce `docs/design-handoff/index.html` homepage section by section using `@nestself/ui` and the `marketing` catalog, inside `<main id="main" tabIndex={-1}>` with `@container` set on the page wrapper so the handoff container breakpoints (1000 px, 760 px, 599 px) apply as `@max-[1000px]:`, `@max-[760px]:`, `@max-[599px]:` variants:

1. `SiteHeader` — wordmark `nestself` (`text-[1.9rem] tracking-[-0.065em] font-[var(--font-weight-label)] text-primary`), links to `#support`, `#how`, `#life`, `#employers`.
2. Hero (`section aria-labelledby="home-title"`, `grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-12 py-16 pb-18 @max-[760px]:grid-cols-1`): `Eyebrow`, `h1 type-marketing-hero` two lines, `type-body-large` lead, actions (`LinkButton` primary → `#support`, secondary → `#employers`), `CoverageNotice`, and the photo group: `PhotoFigure photo="family-grass" role="hero-3x2" priority` as the lead spanning both columns, `PhotoFigure photo="friends-men"` and `photo="care-home"` as supporting 4:5-ish tiles (`aspect-[1.35]` at narrow widths), caption `hero.caption`. Alt texts from the catalog.
3. Support (`id="support"`, `py-20 border-t border-border-subtle`): intro grid (eyebrow, `type-editorial` title, lead), layout `grid-cols-[5fr_7fr] gap-16` with `PhotoFigure photo="friends-bench"` and three rows (`CategoryIcon` mentalSupport / legal / financial at 40 px, title `type-section-title`, body, `ArrowRight`), each a link to `/support#<area>`.
4. How it works (`id="how"`, `bg-canvas py-20`): three `article.step` with `border-t border-border-control pt-6`, numbered eyebrow `01/02/03` tabular.
5. Life (`id="life"`, `py-22`): heading block max 44rem, gallery `grid-cols-[5fr_3fr_4fr] gap-4` of three `PhotoFigure`s with captions (grandfather, family-play portrait, couple-cooking), collapsing to the handoff mobile arrangement.
6. Employers (`id="employers"`, `bg-primary text-on-primary py-16`): two-column with copy, `LinkButton variant="on-brand"` → `/employers`, `PhotoFigure photo="family-autumn"`.
7. Privacy block (`grid-cols-[auto_1fr_auto] gap-6 py-12 border-b`): `LockKey` icon, title + body, `Button variant="secondary" size="sm"` opening `PrivacyDialog` (Dialog with the four rows and the disclaimer; "View the full model" links to `/privacy-model`).
8. Footer: wordmark, tagline, links `Photography direction` (→ `/credits#photography`), `Photo credits` (opens `CreditsDialog` listing the ten photographers with Pexels links from `@nestself/assets`), `Design system` (→ Storybook URL from `src/lib/site.ts`, `http://localhost:6006` in development, disabled otherwise).

No analytics, no cookie banner, no newsletter form, no testimonials, logos or statistics.

- [ ] **Step 4: Secondary pages** — `/support` (three area sections with `CategoryIcon`, the handoff descriptions and a `StatusBlock state="empty"`-style note that content and booking live in the employee app; a sign-in link to the workspace URL from env is a plain link), `/employers` (the employer copy plus the HR visibility principles from the handoff: aggregates only, protected is not zero, roles enforced server-side), `/privacy-model` (the access matrix from `@nestself/contracts` rendered with `Table`, plus the disclaimer), `/credits` (photographs table from `@nestself/assets`, fonts, icons — same content as `CREDITS.md`), `not-found.tsx`. `robots.ts` allows all and points to the sitemap; `sitemap.ts` lists the five routes per locale with `alternates.languages`.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @nestself/marketing images:sync && pnpm --filter @nestself/marketing lint && pnpm --filter @nestself/marketing typecheck && pnpm --filter @nestself/marketing test && pnpm --filter @nestself/marketing build 2>&1 | tail -25`
Expected: build succeeds, route list shows `/[locale]`, `/[locale]/support`, `/[locale]/employers`, `/[locale]/privacy-model`, `/[locale]/credits`, `/robots.txt`, `/sitemap.xml` as static (`●`/`○`). Then start `pnpm --filter @nestself/marketing dev` in the background, `curl -sI http://localhost:3000/ | head -3` shows a 307 to `/en`, `curl -s http://localhost:3000/en | grep -c 'family-grass'` ≥ 1, `curl -s http://localhost:3000/sr-Cyrl | grep -o 'lang="sr-Cyrl"'` matches, then stop the server. Write `README.md` (routes, locale behaviour, image sync, no-analytics policy).

### Task 3.2: `apps/workspace` — the client-organisation SPA

**Files:** `index.html`, `vite.config.ts`, `vitest.config.ts`, `src/main.tsx`, `src/app.css`, `src/i18n.ts`, `src/vite-env.d.ts`, `src/session.tsx`, `src/api.ts`, `src/routeTree.gen.ts` (generated, committed), `src/routes/**`, `src/components/**`, `src/test/setup.ts`, tests, `README.md`.

- [ ] **Step 1: Config**

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', routesDirectory: './src/routes', generatedRouteTree: './src/routeTree.gen.ts', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  build: { sourcemap: true },
});
```
(If the plugin export is `TanStackRouterVite` in 1.168.47 rather than `tanstackRouter`, use that name; check `node_modules/@tanstack/router-plugin/dist/esm/vite.d.ts`.) The router plugin must precede the React plugin.

`src/app.css`: `@import "tailwindcss"; @import "@nestself/ui/styles.css"; @source "../../../packages/ui/src";`
`index.html`: `<html lang="en" data-palette="forest" data-mode="light" data-font="onest">`, the theme boot script inline (copy of `themeBootScript()` output generated at build via a tiny Vite plugin is unnecessary: inline the same guarded 8-line script literally), `<div id="root"></div>`.
`src/vite-env.d.ts`: `VITE_API_URL`, `VITE_DATA_SOURCE` typed.
`src/i18n.ts`: `i18next.use(initReactI18next).use(LanguageDetector).init({ ...i18nBaseOptions, resources: resourcesFor(['common','workspace']), detection: { order: ['localStorage','navigator'], caches: ['localStorage'], lookupLocalStorage: 'nestself-locale' } })`; after init, set `document.documentElement.lang = localeMeta[i18next.resolvedLanguage].htmlLang` and keep it in sync on `languageChanged`.
`src/session.tsx`: `SessionProvider` holding a `Session` from `SAMPLE_SESSIONS` (default `employee`) with a dev-only role switcher exposed through `useSession()`; this is a stub, labelled as such in code comments and in the UI (inside the ThemeStudio panel as "Sample role").
`src/api.ts`: `createApiClient({ baseUrl: import.meta.env.VITE_API_URL ?? '' })` (empty base uses the Vite proxy).

- [ ] **Step 2: Routes**

```
src/routes/__root.tsx                 providers: QueryClientProvider, I18nextProvider, ThemeProvider, ToastProvider, AnnouncerProvider, SessionProvider; SkipLink; SampleDataBanner when sample mode; dev ThemeStudio; notFoundComponent → StatusBlock permission-style "not found"
src/routes/_authenticated.tsx         beforeLoad: context.session must exist (always true with the stub) ; component: AppShell with Sidebar/Topbar/BottomBar NavItems (home, support, appointments, messages, channels, polls, settings; plus Manage for manager/hr_admin and Employer space for hr_admin)
src/routes/_authenticated/index.tsx   employee home
src/routes/_authenticated/support/index.tsx
src/routes/_authenticated/support/$area.tsx            validates $area with SupportAreaSchema, else notFound
src/routes/_authenticated/channels/index.tsx
src/routes/_authenticated/channels/$channelId.tsx
src/routes/_authenticated/polls/index.tsx
src/routes/_authenticated/appointments.tsx
src/routes/_authenticated/messages/index.tsx
src/routes/_authenticated/messages/$threadId.tsx
src/routes/_authenticated/settings.tsx
src/routes/_authenticated/_manager.tsx                 beforeLoad: canManageTeam(session) else throw redirect({ to: '/', search: { denied: 'manager' } })
src/routes/_authenticated/_manager/manage/index.tsx
src/routes/_authenticated/_manager/manage/polls.new.tsx
src/routes/_authenticated/_manager/manage/events.new.tsx
src/routes/_authenticated/_hr.tsx                      beforeLoad: canAccessHr(session) else redirect to '/' with search denied: 'hr'
src/routes/_authenticated/_hr/hr/index.tsx
src/routes/_authenticated/_hr/hr/eligibility.tsx
src/routes/_authenticated/_hr/hr/reports.tsx
src/routes/_authenticated/_hr/hr/events.tsx
```
Router context type `{ queryClient: QueryClient; session: Session }`; `createRouter({ routeTree, context, defaultPreload: 'intent', scrollRestoration: true })`; `Register` module augmentation in `main.tsx`. The home route reads `search.denied` (zod `validateSearch`) and shows `StatusBlock state="permission"` above the content when present.

- [ ] **Step 3: Representative screens**

- Home: greeting with the session display name, three `CategoryIcon` cards linking to `/support/<area>`, "Next appointment" card from `SAMPLE_BOOKING` (advisor initials `Avatar`, date/time formatted with `formatDateTime`, `CoverageNotice`), channel digest (latest two `SAMPLE_POSTS`), at most one `PhotoFigure` (`family-play`, role `card`, lazy) — employee home allows one optional photo.
- `/support/$area`: area title and description, `PrivacyAtPointOfUse`, list of `SAMPLE_CONTENT` for the area, `SAMPLE_EXPERTS` for the area with initials, and the `BookingDemo` from `@nestself/ui` fed with `SAMPLE_BOOKING` (prices via `formatCurrency` with the active locale); completion announces through `useAnnounce` and shows a `Toast` with `common.sample.demoNoop`.
- `/channels/$channelId`: feed of `SAMPLE_POSTS` for the channel (author initials, relative date via `formatDate`), a disabled composer with a note that posting is not connected.
- `/hr`: `MetricCard`s for eligible, available fund, reserved; `Table` (default density) with the four programme measures from the handoff where the team breakdown row is `ProtectedValue`; the `hr.protectedNote`; `EventRequestSummary` with `SAMPLE_EVENT_REQUEST`.
- `/settings`: locale `Select` (changes i18next language and persists), appearance (`mode` light/dark switch via `useTheme`), and the privacy text.
- Every other route: `Heading` + `StatusBlock state="empty"` with the relevant copy (e.g. appointments empty state).
- Health probe: `__root` mounts a tiny `ApiStatus` indicator in the Topbar using `useQuery(healthQueryOptions(api))`: green dot "API connected" when `status === 'ok'`, otherwise a `Badge tone="warning"` "API not connected (sample mode)" — never blocks the UI.

- [ ] **Step 4: Tests** (`src/routes/*.test.tsx` with a memory history router): rendering `/hr` with an `employee` session redirects to `/` and shows the permission `StatusBlock`; with `hr_admin` renders the programme heading; `/support/legal` renders the booking demo and its confirm button contains the formatted amount; `/support/unknown` renders not found; locale switch in settings changes `document.documentElement.lang` to `sr-Cyrl`.

- [ ] **Step 5: Verify**: `images:sync`, lint, typecheck, test, `vite build` succeeds; `vite preview` serves `/` (check with curl for `id="root"`). `README.md` with routes and the stub-session note.

### Task 3.3: `apps/admin` — NestSelf back office SPA

Same configuration as 3.2 with port 5174 and `resourcesFor(['common','admin'])`. Routes: `__root`, `_authenticated` (session must have a `platformRole`; otherwise `StatusBlock permission`), `/` overview (status blocks: experts count, organisations count, open event requests from sample data, each labelled sample), `/experts` (`Table` with density switch default/compact — compact only on fine pointers — columns name (initials `Avatar` + name), area, languages, format; note `experts.realPortraitNote`), `/experts/$expertId`, `/organizations`, `/organizations/$orgId` (teams, membership counts, programme figures as `MetricCard`s), `/content` (sample articles with area and locale badges), `/event-requests` (`EventRequestSummary`), `/settings`. HR density: `max-w-hr`. Tests: experts table renders three rows and the compact toggle changes row height class; a session without `platformRole` sees the permission block. Verify as in 3.2.

### Task 3.4: `apps/mobile` — Expo

**Files:** `app.config.ts` (replaces `app.json`), `metro.config.js`, `babel.config.js`, `expo-env.d.ts`, `src/app/_layout.tsx`, `src/app/(tabs)/_layout.tsx`, `src/app/(tabs)/index.tsx`, `src/app/(tabs)/support.tsx`, `src/app/(tabs)/appointments.tsx`, `src/app/(tabs)/messages.tsx`, `src/app/support/[area].tsx`, `src/app/channels/[id].tsx`, `src/app/settings.tsx`, `src/app/+not-found.tsx`, `src/i18n.ts`, `src/providers/{theme.tsx,session.tsx}`, `src/lib/{storage.ts,locale.ts,locale.test.ts}`, `src/components/**`, `README.md`.

- [ ] `app.config.ts`:
```ts
import type { ConfigContext, ExpoConfig } from 'expo/config';
import tokens from '@nestself/tokens/tokens.json' with { type: 'json' };
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'NestSelf',
  slug: 'nestself-mobile',
  scheme: 'nestself',
  version: '0.0.1',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: { bundleIdentifier: 'com.nestself.mobile', supportsTablet: false },
  android: { package: 'com.nestself.mobile', adaptiveIcon: { backgroundColor: tokens.themes.forest.light.canvas } },
  plugins: ['expo-router', 'expo-font', 'expo-localization', 'expo-splash-screen'],
  experiments: { typedRoutes: true },
});
```
If the JSON import attribute is rejected by the Expo config loader, read the file with `fs` instead; never paste the hex.
`metro.config.js`: `const { getDefaultConfig } = require('expo/metro-config'); module.exports = getDefaultConfig(__dirname);` (SDK 58 resolves workspace packages automatically; add nothing else unless resolution fails, and record it).
- [ ] `_layout.tsx`: `useFonts({ 'Onest-Regular': require('@nestself/assets/fonts/native/Onest-Regular.ttf'), 'Onest-SemiBold': ..., 'Onest-Bold': ... })`, splash until fonts load, `I18nextProvider`, `ThemeProvider` from `@nestself/ui-native` with persistence through AsyncStorage (`src/lib/storage.ts`), `SessionProvider` (sample employee), `Stack`. `src/i18n.ts`: `expo-localization` `getLocales()` → `negotiateLocale(tags)`; resources `resourcesFor(['common','mobile'])`; persisted override in AsyncStorage. Test `locale.test.ts`: tag lists resolve as in the i18n package tests (pure function wrapper).
- [ ] Tabs: Home, Support, Appointments, Messages with `phosphor-react-native` icons (`House`, `Heart`, `CalendarCheck`, `ChatCircleText`), `weight="fill"` when focused, labels from `mobile` catalog, `tabBarStyle` height ≥ 64 + safe area, colours from `useTheme().colors`.
- [ ] Home screen mirrors the handoff phone demonstration: top row wordmark + `Avatar` initials, `Text role="screenTitle"` greeting, next-appointment `Card` (advisor initials, date/time via `formatDateTime`, `CoverageNotice` text), three category `ListRow`s with `CategoryIcon`. `support/[area]`: area intro + a native `BookingDemo` built from `ui-native` primitives (advisor → time grid of chips → review with `CostBreakdown` and a confirm button whose label includes the amount → done state saying nothing was created). Other screens: `StatusBlock` empty states. `settings`: locale and mode switches. A `SampleDataBanner` (ui-native `Alert tone="warning"`) at the top of each tab when sample mode.
- [ ] Verify: `pnpm --filter @nestself/mobile lint && typecheck && test`; then `pnpm --filter @nestself/mobile export 2>&1 | tail -15` (bundles iOS JS with Metro without a device; expected `Exported: dist` with no resolution errors). Do not run `expo run:ios` (native build) in this task; the orchestrator starts the simulator in Phase 4. `README.md`: Expo Go instructions, the watchman note (polling), font note, Uniwind upgrade path.

### Task 3.5: `apps/api` — NestJS scaffold with Prisma skeleton and server-side roles

**Files:** `prisma.config.ts`, `prisma/schema.prisma`, `prisma/seed.ts`, `.env.example`, `src/main.ts`, `src/app.module.ts`, `src/config/env.ts`, `src/prisma/{prisma.module.ts,prisma.service.ts}`, `src/health/{health.module.ts,health.controller.ts,prisma.health.ts}`, `src/auth/{auth.module.ts,auth.guard.ts,roles.guard.ts,roles.decorator.ts,public.decorator.ts,current-user.decorator.ts,types.ts}`, `src/programme/{programme.module.ts,programme.controller.ts}`, `src/auth/roles.guard.spec.ts`, `test/health.e2e.spec.ts`, `README.md`.

- [ ] **Step 1: Prisma 7**

`prisma.config.ts`:
```ts
import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';
export default defineConfig({
  schema: path.join(import.meta.dirname, 'prisma', 'schema.prisma'),
  migrations: { path: path.join(import.meta.dirname, 'prisma', 'migrations'), seed: 'tsx prisma/seed.ts' },
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://nestself:nestself_dev@localhost:5432/nestself' },
});
```
(Check `node_modules/prisma/config.d.ts` for the exact export name and option shape in 7.10.1 — `defineConfig` from `prisma/config`; adjust `datasource.url` vs `url` to what the types accept.)

`prisma/schema.prisma`:
```prisma
datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

enum OrgRole {
  EMPLOYEE
  MANAGER
  HR_ADMIN
}

enum PlatformRole {
  EXPERT
  OPERATIONS
  ADMIN
}

enum SupportArea {
  PSYCHOLOGICAL
  LEGAL
  FINANCIAL
}

enum ChannelScope {
  ORGANIZATION
  TEAM
}

enum ContentKind {
  ARTICLE
  FAQ
  VIDEO
}

enum EventRequestStatus {
  REQUESTED
  OFFERS_READY
  SELECTED
  CLOSED
}

model Organization {
  id          String       @id @default(cuid())
  name        String
  slug        String       @unique
  createdAt   DateTime     @default(now()) @map("created_at")
  updatedAt   DateTime     @updatedAt @map("updated_at")
  teams       Team[]
  memberships Membership[]
  channels    Channel[]
  eventRequests EventRequest[]

  @@map("organizations")
}

model Team {
  id          String       @id @default(cuid())
  name        String
  orgId       String       @map("org_id")
  org         Organization @relation(fields: [orgId], references: [id])
  memberships Membership[]
  channels    Channel[]
  polls       Poll[]

  @@map("teams")
}

model User {
  id           String        @id @default(cuid())
  email        String        @unique
  displayName  String        @map("display_name")
  locale       String        @default("en")
  platformRole PlatformRole? @map("platform_role")
  createdAt    DateTime      @default(now()) @map("created_at")
  updatedAt    DateTime      @updatedAt @map("updated_at")
  memberships  Membership[]
  posts        Post[]
  pollVotes    PollVote[]
  expert       Expert?

  @@map("users")
}

model Membership {
  id     String  @id @default(cuid())
  role   OrgRole @default(EMPLOYEE)
  userId String  @map("user_id")
  orgId  String  @map("org_id")
  teamId String? @map("team_id")
  user   User         @relation(fields: [userId], references: [id])
  org    Organization @relation(fields: [orgId], references: [id])
  team   Team?        @relation(fields: [teamId], references: [id])

  @@unique([userId, orgId])
  @@map("memberships")
}

model Channel {
  id      String       @id @default(cuid())
  name    String
  scope   ChannelScope
  orgId   String       @map("org_id")
  teamId  String?      @map("team_id")
  org     Organization @relation(fields: [orgId], references: [id])
  team    Team?        @relation(fields: [teamId], references: [id])
  posts   Post[]

  @@map("channels")
}

model Post {
  id        String   @id @default(cuid())
  body      String
  channelId String   @map("channel_id")
  authorId  String   @map("author_id")
  createdAt DateTime @default(now()) @map("created_at")
  channel   Channel  @relation(fields: [channelId], references: [id])
  author    User     @relation(fields: [authorId], references: [id])

  @@map("posts")
}

model Poll {
  id        String       @id @default(cuid())
  question  String
  teamId    String       @map("team_id")
  closesAt  DateTime?    @map("closes_at")
  createdAt DateTime     @default(now()) @map("created_at")
  team      Team         @relation(fields: [teamId], references: [id])
  options   PollOption[]

  @@map("polls")
}

model PollOption {
  id     String     @id @default(cuid())
  label  String
  pollId String     @map("poll_id")
  poll   Poll       @relation(fields: [pollId], references: [id])
  votes  PollVote[]

  @@map("poll_options")
}

model PollVote {
  id       String     @id @default(cuid())
  optionId String     @map("option_id")
  userId   String     @map("user_id")
  option   PollOption @relation(fields: [optionId], references: [id])
  user     User       @relation(fields: [userId], references: [id])

  @@unique([optionId, userId])
  @@map("poll_votes")
}

model Expert {
  id        String      @id @default(cuid())
  userId    String      @unique @map("user_id")
  area      SupportArea
  languages String[]
  bio       String?
  user      User        @relation(fields: [userId], references: [id])
  contents  ContentItem[]

  @@map("experts")
}

model ContentItem {
  id        String      @id @default(cuid())
  title     String
  summary   String
  body      String
  kind      ContentKind
  area      SupportArea
  locale    String      @default("en")
  expertId  String?     @map("expert_id")
  expert    Expert?     @relation(fields: [expertId], references: [id])
  createdAt DateTime    @default(now()) @map("created_at")
  updatedAt DateTime    @updatedAt @map("updated_at")

  @@map("content_items")
}

model EventRequest {
  id           String             @id @default(cuid())
  orgId        String             @map("org_id")
  participants Int
  location     String
  dateRange    String             @map("date_range")
  budget       String
  purpose      String
  options      String[]
  status       EventRequestStatus @default(REQUESTED)
  createdAt    DateTime           @default(now()) @map("created_at")
  org          Organization       @relation(fields: [orgId], references: [id])

  @@map("event_requests")
}
```
Appointments, payments, messages and credits are intentionally absent: they need contractual rules (see the spec, section 17).

`prisma/seed.ts`: imports `assertNotProduction` from `@nestself/sample-data` and the fixtures; upserts the sample organisation, teams, users, memberships, channels, posts, poll, experts and content; prints counts. Refuses to run when `NODE_ENV=production`.

- [ ] **Step 2: Nest app**

`src/config/env.ts`: zod schema (`NODE_ENV`, `PORT` default 4000, `DATABASE_URL` url, `JWT_SECRET` min 32, `JWT_EXPIRES_IN` default `1h`, the three allowed origins optional) and `validateEnv(config) { return envSchema.parse(config) }`.
`src/main.ts`: as in the research setup (helmet, CORS for the three origins, global prefix `api`, `ValidationPipe`, Swagger at `/api/docs` only when `NODE_ENV !== 'production'`, `EMIT_OPENAPI=true` writes `openapi.json` and exits, listen on `PORT`).
`src/app.module.ts`: `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })`, `LoggerModule` (pino, pretty in dev), `JwtModule.registerAsync` (global), `ThrottlerModule`, `PrismaModule`, `HealthModule`, `AuthModule`, `ProgrammeModule`; `APP_GUARD`s in order: `AuthGuard`, `RolesGuard`, `ThrottlerGuard`.
`src/prisma/prisma.service.ts`: `PrismaClient` from `../generated/prisma/client.js` with `new PrismaPg({ connectionString })`.
`src/auth/types.ts`: `AuthUser { userId; displayName; platformRole: PlatformRole | null; memberships: { orgId: string; role: OrgRole }[] }` (use the contracts enums, lower-case values; map Prisma enums in a small adapter).
`src/auth/auth.guard.ts`: reads `Authorization: Bearer <jwt>`; verifies with `JwtService`; attaches `request.user`; routes decorated with `@Public()` skip it; invalid or missing token → 401.
`src/auth/roles.decorator.ts`: `@Roles(...roles: Array<OrgRole | PlatformRole>)` and `@OrgParam('orgId')` metadata naming the route param that scopes the check.
`src/auth/roles.guard.ts`: when `@Roles` is present, allows if the user's `platformRole` is in the list, or if the user has a membership in `request.params[orgParam]` whose role is in the list; otherwise 403. No roles metadata → allow. This is the server-side enforcement the handoff requires.
`src/programme/programme.controller.ts`: `@Controller('orgs/:orgId/programme')`, `@Get()` with `@Roles('hr_admin', 'operations', 'admin')` `@OrgParam('orgId')`, returns `{ sample: true, note: 'Placeholder. Programme figures come from contracts and a privacy risk assessment.', eligibleEmployees: null }` — no numbers, no sample figures from the API.
`src/health/*`: Terminus with the Prisma indicator (`SELECT 1`), `@Public()`.

- [ ] **Step 3: Tests**

`src/auth/roles.guard.spec.ts`: builds `RolesGuard` with a `Reflector` stub; an `employee` membership on `org_1` is denied for `@Roles('hr_admin')` on `/orgs/org_1/programme`; `hr_admin` on `org_1` is allowed; `hr_admin` on `org_2` is denied for `org_1`; platform `operations` is allowed; a route without roles metadata is allowed. `test/health.e2e.spec.ts`: boots the Nest app with `PrismaService` overridden by a stub whose `$queryRawUnsafe` resolves, `GET /api/health` returns 200 with `status: 'ok'`; with a rejecting stub returns 503 with `status: 'error'`.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @nestself/api prisma:generate && pnpm --filter @nestself/api lint && pnpm --filter @nestself/api typecheck && pnpm --filter @nestself/api test && pnpm --filter @nestself/api build 2>&1 | tail -10`
Expected: client generated into `src/generated/prisma`, tests pass, `dist/main.js` exists. Do not run migrations in this task (the orchestrator does it in Phase 4 against a temporary database). `.env.example` as in the root file. `README.md`: run instructions, role enforcement explanation, what is deliberately missing.

Barrier after Phase 3 (orchestrator): `pnpm lint && pnpm typecheck && pnpm test && pnpm check && pnpm build`; commit `feat: marketing, workspace, admin, mobile and api scaffolds`.

---

## Phase 4 — Integration, documentation and real-browser verification (sequential)

### Task 4.1: Playwright, root docs

**Files:** `playwright.config.ts`, `e2e/{screenshots.spec.ts,a11y.spec.ts,reflow.spec.ts,helpers.ts}`, `README.md`, `CLAUDE.md`, `CREDITS.md` (generated), `docs/environment.md`.

- [ ] `playwright.config.ts`: `testDir: './e2e'`, `snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}'`, `expect.toHaveScreenshot.maxDiffPixelRatio: 0.02`, projects `mobile-390` (390×844, `deviceScaleFactor: 2`, `isMobile: true`, `hasTouch: true`), `desktop-1440` (1440×900), `reflow-320` (320×568); `webServer` array starting marketing (`pnpm --filter @nestself/marketing dev`, port 3000), workspace (5173) and admin (5174) with `reuseExistingServer: !process.env.CI`, timeout 120 s; `use: { baseURL: 'http://localhost:3000', locale: 'en-GB', timezoneId: 'Europe/Belgrade', reducedMotion: 'reduce' }`.
- [ ] `e2e/helpers.ts`: `setTheme(page, { palette, mode })` via `page.addInitScript` writing the `nestself-theme` storage key; `setLocale(page, locale)` writing `nestself-locale`; `waitForFonts(page)` awaiting `document.fonts.ready`.
- [ ] `e2e/screenshots.spec.ts`: for `mobile-390` and `desktop-1440`: marketing home `/en` (default), marketing home `/sr-Cyrl`, marketing home in `forest/dark`, workspace home `/`, workspace booking `/support/psychological` (after clicking through to the review step), workspace HR `/hr` (hr_admin session via a `?role=hr_admin` dev search param supported by the SessionProvider stub in development), admin experts `/experts` — `await expect(page).toHaveScreenshot(name, { fullPage: true })`.
- [ ] `e2e/a11y.spec.ts`: `AxeBuilder.withTags(['wcag2a','wcag2aa','wcag22aa'])` on marketing home, workspace home, workspace booking review step, admin experts, in both viewports; expect zero violations; also keyboard: on marketing home press Tab once and expect the skip link focused; open the privacy dialog with the keyboard, expect focus inside, Escape returns focus to the button.
- [ ] `e2e/reflow.spec.ts` (project `reflow-320`): marketing home and workspace home have `document.documentElement.scrollWidth <= 320` after load (no horizontal scroll), and the hero image is visible.
- [ ] Root `README.md`: purpose, apps and packages table, prerequisites (Node 24, pnpm 10.10, Postgres via Docker or local), first run (`pnpm install`, `pnpm images:build`, `pnpm dev`), per-app commands and ports, sample mode, checks (`pnpm verify`, `pnpm e2e`, `pnpm storybook`), API database steps (`pnpm db:up`, `pnpm --filter @nestself/api prisma:migrate`, seed), mobile (Expo Go, simulator, watchman note), known gaps (from the spec section 17), decisions log pointer to the spec.
- [ ] Root `CLAUDE.md`: repo conventions (JIT packages, catalog versions, colour rule, content rule, sample-data rule, server-side roles, no installs in parallel work, where tests live, how to add a component), and "Design constraints in `docs/design-handoff/CLAUDE.md` still apply."
- [ ] `docs/environment.md`: every env var from `.env.example` with meaning and default.

### Task 4.2: Orchestrator verification (done by the orchestrating session, not a worker)

- [ ] `pnpm verify` passes from the repo root (lint, typecheck, test, check, build).
- [ ] Temporary database: `initdb -D <scratchpad>/pg -U nestself --auth=trust`, `pg_ctl -D <scratchpad>/pg -o "-p 54329 -k <scratchpad>" -l <scratchpad>/pg.log start`, `createdb -h localhost -p 54329 -U nestself nestself`; `DATABASE_URL=postgresql://nestself@localhost:54329/nestself pnpm --filter @nestself/api prisma:migrate -- --name init` creates `prisma/migrations/<ts>_init`; seed runs; start the API with that URL and `curl -s localhost:4000/api/health` returns `"status":"ok"`; `curl -si localhost:4000/api/orgs/org_sample/programme` returns 401 without a token; stop the API and `pg_ctl stop`. Commit the migration.
- [ ] `pnpm e2e` with the three dev servers; open every PNG under `e2e/__screenshots__` with the Read tool and compare with `docs/design-handoff/index.html` hierarchy; fix layout defects at the source and re-run until the screenshots match the intent; commit the screenshots.
- [ ] Mobile: `xcrun simctl create "NestSelf iPhone" "iPhone 15" "com.apple.CoreSimulator.SimRuntime.iOS-17-5"`, boot it, `pnpm --filter @nestself/mobile exec expo start --ios` (Expo Go) with a 5-minute budget; if Expo Go for SDK 58 cannot run on iOS 17.5 or the install fails, record the exact error and rely on the `expo export` bundle check. Screenshot the simulator (`xcrun simctl io booted screenshot`) when the home screen renders and view it.
- [ ] Final commit `chore: e2e checks, docs and verification artefacts`; write the final report (structure, token mapping, checks performed, unimplemented states, deviations).

## Self-review notes (filled in by the plan author before execution)

- Spec coverage: §4 layout → Task 0.1/0.4; §5 tooling → 0.1–0.5; §6 tokens → 1.1; §7 assets → 1.2; §8 ui → 2.1–2.3; §9 native → 2.4; §10 i18n → 1.4; §11 apps → 3.1–3.5; §12 roles → 1.3 + 3.5; §13 sample data → 1.5 + apps; §14 accessibility → 2.x tests + 4.1; §15 checks → 0.5, 1.1, 1.4, 4.1, 4.2; §16 docs/git → 4.1 + barriers; §17 unimplemented → README; §18 risks → onlyBuiltDependencies (0.1), catalog pins (0.1), TTF fonts (1.2), metro defaults (3.4), Storybook (2.1), watchman note (3.4), transliteration exceptions (1.4).
- Deviations from the spec: Base UI package is `@base-ui/react` (renamed upstream); TypeScript 5.9.3 instead of "5.x latest" wording; Vitest 5 on jsdom with Playwright for real-browser checks instead of Vitest browser mode; `routeTree.gen.ts` committed; the Tailwind bridge lives in `@nestself/tokens/tailwind.css`.

---

## Appendix A — added 2026-10-20 after the user asked for Playwright e2e, Vitest unit tests and screenshot-driven verification

### Task 1.7: Playwright e2e scaffold and the screenshot helper (runs in Phase 1, in parallel with 1.1–1.6)

**Files:** `playwright.config.ts` (root), `e2e/helpers.ts`, `e2e/pages.ts`, `e2e/screenshots.spec.ts`, `e2e/a11y.spec.ts`, `e2e/reflow.spec.ts`, `e2e/snap.mjs`, `e2e/README.md`. Unit tests everywhere else stay on Vitest (already configured per package in Phase 0).

- [ ] **Step 1: `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

const CI = !!process.env.CI;
export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? 'github' : [['list'], ['html', { open: 'never', outputFolder: 'e2e/playwright-report' }]],
  outputDir: 'e2e/test-results',
  timeout: 60_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' } },
  use: { baseURL: 'http://localhost:3000', locale: 'en-GB', timezoneId: 'Europe/Belgrade', reducedMotion: 'reduce', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    { name: 'reflow-320', use: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, testMatch: /reflow\.spec\.ts/ },
  ],
  webServer: [
    { command: 'pnpm --filter @nestself/marketing dev', url: 'http://localhost:3000', reuseExistingServer: !CI, timeout: 180_000 },
    { command: 'pnpm --filter @nestself/workspace dev', url: 'http://localhost:5173', reuseExistingServer: !CI, timeout: 180_000 },
    { command: 'pnpm --filter @nestself/admin dev', url: 'http://localhost:5174', reuseExistingServer: !CI, timeout: 180_000 },
  ],
});
```
The `mobile-390` and `desktop-1440` projects run `screenshots.spec.ts` and `a11y.spec.ts`; `reflow-320` runs only `reflow.spec.ts` (use `testIgnore` on the first two projects so reflow does not run there).

- [ ] **Step 2: `e2e/pages.ts`** — the registry every spec iterates. Start with the three roots; app tasks append their representative routes.
```ts
export interface PageEntry { name: string; url: string; theme?: { palette: 'forest' | 'ink' | 'plum' | 'azure'; mode: 'light' | 'dark' }; locale?: 'en' | 'sr-Latn' | 'sr-Cyrl'; prepare?: string; }
export const pages: PageEntry[] = [
  { name: 'marketing-home', url: 'http://localhost:3000/en' },
  { name: 'marketing-home-sr-cyrl', url: 'http://localhost:3000/sr-Cyrl' },
  { name: 'marketing-home-dark', url: 'http://localhost:3000/en', theme: { palette: 'forest', mode: 'dark' } },
  { name: 'workspace-home', url: 'http://localhost:5173/' },
  { name: 'admin-home', url: 'http://localhost:5174/' },
];
```
`prepare` is an optional named interaction implemented in `helpers.ts` (`prepareActions` map, e.g. `'booking-review'` clicks through the booking demo to the review step).

- [ ] **Step 3: `e2e/helpers.ts`** — `applyTheme(page, theme)` and `applyLocale(page, locale)` via `page.addInitScript` writing `localStorage['nestself-theme']` (JSON `{palette,mode,font:'onest'}`) and `localStorage['nestself-locale']`; `settle(page)` awaits `networkidle`, `document.fonts.ready` and two animation frames; `collectConsoleErrors(page)` returning an array that specs assert empty; `prepareActions`.

- [ ] **Step 4: Specs** — `screenshots.spec.ts`: for each page entry, apply theme/locale, goto, run `prepare`, `settle`, `expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true })`, and expect no console errors. `a11y.spec.ts`: `AxeBuilder.withTags(['wcag2a','wcag2aa','wcag22aa'])` per page, `expect(violations).toEqual([])`; plus keyboard checks on `marketing-home` (first Tab focuses the skip link; the privacy dialog traps focus and Escape returns it to its trigger — mark this test `test.fixme` until Task 3.1 ships the dialog, and remove the fixme in 3.1). `reflow.spec.ts`: for every page, `document.documentElement.scrollWidth <= 320`.

- [ ] **Step 5: `e2e/snap.mjs` — the ad-hoc screenshot tool used during implementation**

```
node e2e/snap.mjs <url> [--out <dir>] [--name <base>] [--palette forest] [--mode dark] [--locale sr-Cyrl] [--viewport mobile|desktop|both] [--selector <css>] [--no-full]
```
Uses `import { chromium } from '@playwright/test'`; captures `mobile` (390×844, dpr 2, touch) and/or `desktop` (1440×900) full-page PNGs named `<base>-mobile.png` / `<base>-desktop.png` into `--out` (default `./e2e/snaps`, git-ignored), applying theme/locale through the same `localStorage` keys before navigation, waiting for `networkidle` and `document.fonts.ready`, printing each saved path, printing console errors and failed requests, and exiting 1 when the main response status is ≥ 400 or any console error occurred (so a blank page is never mistaken for success). `--selector` screenshots only that element.

- [ ] **Step 6: Verify** — `pnpm exec playwright test --list` lists the tests across the three projects; `node e2e/snap.mjs https://example.com --out /private/tmp/claude-501/-Users-draganpodrascanin-Desktop-projects-Nestself/3841c7b3-c734-41e5-ae5f-cb494614968e/scratchpad/snaps --name example` writes two PNGs (open one with the Read tool to confirm it is a rendered page); `pnpm lint` passes for `e2e` (add `e2e/eslint.config.js` re-exporting the node preset with browser globals for the page-evaluated code, and `e2e/**` to the root lint via a root `eslint.config.js` that re-exports the node preset); `pnpm exec tsc -p e2e/tsconfig.json --noEmit` passes. Add `e2e/snaps/` to `.gitignore`. Do not generate screenshot baselines now (the apps are stubs); Phase 4 runs `pnpm e2e:update` once the apps exist. `e2e/README.md` documents the three commands.

### Phase 3 addendum — screenshot-driven verification for every app task (3.1, 3.2, 3.3; 3.4 uses the simulator in Phase 4)

After the app's dev server runs, the implementer must:
1. Capture every representative screen with `node e2e/snap.mjs http://localhost:<port>/<route> --out <scratchpad>/snaps/<app> --name <route-name>` at both viewports, plus the home screen in `--mode dark` and `--locale sr-Cyrl`.
2. Open each PNG with the Read tool and compare against the handoff composition (`docs/design-handoff/index.html` rendered in a browser is the reference; the section hierarchy, spacing, image placement and type scale must match at 1440 px and the stacked order at 390 px). Check: no horizontal overflow, no clipped text, focus ring visible on the first Tab, images at the right crops, no placeholder text left, sample banner present in sample mode.
3. Fix defects at the source and re-capture until the screens look right.
4. Append the app's representative routes to `e2e/pages.ts` (with any `prepare` action needed) so Phase 4 baselines include them.
5. Report the list of screenshots taken and what was changed because of them.

Spec and quality reviewers for 3.1–3.3 must capture and view their own screenshots of at least the home screen at both viewports and state in `verified` what they saw. A review that did not look at the rendered page is incomplete.
