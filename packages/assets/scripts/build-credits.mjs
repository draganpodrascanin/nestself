#!/usr/bin/env node
// @ts-check
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
const repoRoot = join(pkgRoot, '..', '..');
const photosPath = join(pkgRoot, 'photos.json');

const photos = JSON.parse(readFileSync(photosPath, 'utf8'));

const lines = [];
lines.push('# Credits');
lines.push('');

// Photographs
lines.push('## Photographs');
lines.push('');
lines.push('All photographs are conceptual lifestyle imagery sourced from Pexels under the [Pexels licence](https://www.pexels.com/license/). People shown are not customers, experts, endorsers or evidence of outcomes and family imagery implies no eligibility.');
lines.push('');
lines.push('| Key | Photographer | Pexels Link | Licence |');
lines.push('| --- | --- | --- | --- |');
for (const p of photos) {
  lines.push(`| ${p.key} | ${p.author} | ${p.source} | ${p.license} |`);
}
lines.push('');

// Fonts
lines.push('## Fonts');
lines.push('');
lines.push('All fonts are licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/).');
lines.push('');
lines.push('| Font | Source |');
lines.push('| --- | --- |');
lines.push('| Onest | https://github.com/simpals/onest |');
lines.push('| Commissioner | https://github.com/kosbarts/Commissioner |');
lines.push('| Nunito Sans | https://github.com/googlefonts/NunitoSans |');
lines.push('| Fira Sans | https://github.com/bBoxType/FiraSans |');
lines.push('| Lato | https://www.latofonts.com/lato-free-fonts/ |');
lines.push('');

// Icons
lines.push('## Icons');
lines.push('');
lines.push('Icon subset from [Phosphor Icons](https://github.com/phosphor-icons/core), licensed under the [MIT License](https://opensource.org/licenses/MIT).');
lines.push('');

writeFileSync(join(repoRoot, 'CREDITS.md'), lines.join('\n'));
console.log('CREDITS.md written');
