/**
 * axe-core helper for content package render tests.
 * Same pattern as packages/ui/src/test/axe.ts.
 */
import axe from 'axe-core';

export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag22aa'] },
  });
  const summary = results.violations
    .map(
      (v) =>
        `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join('; ')})`,
    )
    .join('\n');
  if (results.violations.length) {
    throw new Error(`axe violations:\n${summary}`);
  }
}
