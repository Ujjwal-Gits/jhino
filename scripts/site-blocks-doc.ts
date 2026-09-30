/*
 * Writes the reference part of docs/SITE_BLOCKS.md (every block, its variants and props, the theme
 * presets and fonts) from server/site/schema.ts, so the doc never drifts from the code.
 * Run: npx tsx scripts/site-blocks-doc.ts
 */
import fs from 'node:fs';
import { BLOCKS, CATEGORIES, FONTS, LIBRARY, PRESETS, type Field } from '../server/site/schema.js';

const TYPE: Record<string, string> = {
  text: 'inline text (bold, italic, links)', para: 'inline text, several lines', rich: 'rich text (paragraphs, lists, h3, bold, italic, links)',
  plain: 'plain text', url: 'link (https:, mailto:, tel:, page:<id>, #anchor)', image: 'image `{ src, alt, focal? }`', link: 'button `{ label, href, newTab? }`',
  bool: 'true / false', select: 'one of', list: 'list of items', number: 'number', date: 'date `YYYY-MM-DD` (AD; shown in BS or AD on the site)', time: 'time `HH:MM` (24-hour, Nepal time)',
};
const fieldLine = (f: Field, indent = ''): string => {
  let t = TYPE[f.type];
  if (f.type === 'select') t += ': ' + f.options!.map((o) => `\`${o.value}\``).join(', ');
  if (f.max) t += `, up to ${f.max} characters`;
  if (f.type === 'number') t += ` from ${f.lo} to ${f.hi}`;
  let line = `${indent}- \`${f.key}\` (${f.label}): ${t}.${f.hint ? ` ${f.hint}` : ''}`;
  if (f.type === 'list') {
    line += ` Up to ${f.maxItems} ${f.item}s, each:\n` + f.of!.map((x) => fieldLine(x, indent + '  ')).join('\n');
  }
  return line;
};

let out = '<!-- generated: npx tsx scripts/site-blocks-doc.ts -->\n## Blocks\n\n';
for (const c of CATEGORIES) {
  out += `### ${c.name}\n\n`;
  for (const b of BLOCKS.filter((x) => x.category === c.id)) {
    out += `#### \`${b.type}\`: ${b.name}${b.global ? ` (one per site, in \`site.${b.global}\`)` : ''}\n\n${b.description}\n\n`;
    out += `Variants: ${b.variants.map((v) => `\`${v.id}\` (${v.name})`).join(', ')}. The first is the default.\n\n`;
    out += `Props:\n${b.fields.map((f) => fieldLine(f)).join('\n')}\n\n`;
    if (b.form) out += `Form fields visitors send: ${b.form.fields.map((f) => `\`${f.name}\`${f.required ? ' (required)' : ''}`).join(', ')}.\n\n`;
    out += `Defaults: \`${JSON.stringify(b.defaults())}\`\n\n`;
  }
}
out += '## Theme presets\n\n| id | name | display / body font | radius | buttons | rhythm | for |\n| --- | --- | --- | --- | --- | --- | --- |\n';
for (const p of PRESETS) out += `| \`${p.id}\` | ${p.name} | ${p.theme.display} / ${p.theme.body} | ${p.theme.radius} | ${p.theme.button} | ${p.theme.rhythm} | ${p.note} |\n`;
out += '\n## Fonts (self-hosted, `/_jhino/fonts/s-<id>.woff2`)\n\n' + FONTS.map((f) => `- \`${f.id}\`: ${f.name} (${f.kind}, weights ${f.weights.join('–')})`).join('\n') + '\n';
out += '\n## Library photos (`lib:<name>`)\n\n' + Object.entries(LIBRARY).map(([k, l]) => `- \`${k}\`: ${l.alt}`).join('\n') + '\n';

const file = 'docs/SITE_BLOCKS.md';
const doc = fs.readFileSync(file, 'utf8');
const at = doc.indexOf('<!-- generated:');
fs.writeFileSync(file, (at >= 0 ? doc.slice(0, at) : doc + '\n') + out);
console.log(`wrote ${BLOCKS.length} blocks to ${file}`);
