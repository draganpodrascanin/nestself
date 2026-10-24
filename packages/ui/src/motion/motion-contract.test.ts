/**
 * Motion contract (CLAUDE.md, "Motion rule"), run by `pnpm check` and `pnpm test`.
 *
 * Parses every component and app source file and fails when something that
 * pops out, slides or expands would appear or disappear without animation,
 * or when a duration or easing bypasses the motion tokens.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const UI_SRC = join(REPO_ROOT, 'packages/ui/src');
const MOTION_DIR = join(UI_SRC, 'motion');
const SCANNED_DIRS = [UI_SRC, ...['marketing', 'workspace', 'admin'].map((app) => join(REPO_ROOT, 'apps', app, 'src'))];

/** Base UI modules whose popups mount, unmount or hide. */
const POPUP_MODULES = new Set([
  'alert-dialog',
  'autocomplete',
  'combobox',
  'context-menu',
  'dialog',
  'drawer',
  'menu',
  'navigation-menu',
  'popover',
  'preview-card',
  'select',
  'tooltip',
]);
/** Parts that must be composed with a Motion element through `render`. */
const ANIMATED_PARTS = new Set(['Popup', 'Backdrop']);
const COLLAPSIBLE_MODULES = new Set(['accordion', 'collapsible']);
const MOTION_PROPS = new Set(['transition', 'animate', 'exit', 'initial', 'whileHover', 'whileTap', 'whileFocus']);
const LITERAL_TIMING = /(?:^|[\s'"`])(?:[\w-]+:)*(?:duration|delay)-(?:\d|\[\d)|(?:^|[\s'"`])(?:[\w-]+:)*ease-\[/;

interface Violation {
  file: string;
  line: number;
  rule: string;
}

function collectSources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'generated') out.push(...collectSources(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories|gen)\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function kebab(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function jsxAttributes(node: ts.JsxOpeningLikeElement): Map<string, ts.JsxAttribute> {
  const attrs = new Map<string, ts.JsxAttribute>();
  for (const prop of node.attributes.properties) {
    if (ts.isJsxAttribute(prop)) attrs.set(prop.name.getText(), prop);
  }
  return attrs;
}

function tagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

export function checkSource(file: string, text: string): Violation[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: Violation[] = [];
  const insideMotionModule = file.startsWith(MOTION_DIR);
  const insideUi = file.startsWith(UI_SRC);
  const report = (node: ts.Node, rule: string) =>
    violations.push({
      file: relative(REPO_ROOT, file),
      line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      rule,
    });

  /** Local identifier -> Base UI module, e.g. BaseDialog -> dialog. */
  const baseUiNamespaces = new Map<string, string>();
  let importsMotionElements = false;

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
    const named = statement.importClause?.namedBindings;
    if (specifier === 'framer-motion' || specifier.startsWith('framer-motion/')) {
      report(statement, 'import motion, not framer-motion (renamed); apps import it through @nestself/ui');
    }
    if ((specifier === 'motion' || specifier.startsWith('motion/')) && !insideUi) {
      report(statement, 'apps import Motion through @nestself/ui (m, AnimatePresence, MotionFeatures, useMotionPreset)');
    }
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (specifier.startsWith('@base-ui/react/')) baseUiNamespaces.set(element.name.text, specifier.slice('@base-ui/react/'.length));
        if (specifier === '@base-ui/react') baseUiNamespaces.set(element.name.text, kebab(imported));
        if (imported === 'm' && (specifier.endsWith('/motion') || specifier === '@nestself/ui')) importsMotionElements = true;
      }
    }
    if (named && ts.isNamespaceImport(named) && specifier === 'motion/react-m') importsMotionElements = true;
  }

  const ancestors: string[] = [];

  function visitElement(node: ts.JsxOpeningLikeElement) {
    const name = tagName(node);
    const [namespace, part] = name.split('.');
    const module = namespace ? baseUiNamespaces.get(namespace) : undefined;
    if (!module || !part) return;
    const attrs = jsxAttributes(node);

    if (POPUP_MODULES.has(module) && ANIMATED_PARTS.has(part)) {
      if (!attrs.has('render') || !importsMotionElements) {
        report(node, `${name} must be rendered as a Motion element: render={<m.div {...useMotionPreset('…')} />}`);
      }
    }
    if (POPUP_MODULES.has(module) && part === 'Portal') {
      const presence = ancestors.includes('AnimatePresence');
      if (!presence && !attrs.has('keepMounted')) {
        report(node, `${name} must sit inside <AnimatePresence> (with keepMounted) so its exit animation can play`);
      }
      if (presence && module !== 'select' && !attrs.has('keepMounted')) {
        report(node, `${name} inside <AnimatePresence> needs keepMounted, or Base UI unmounts it before the exit plays`);
      }
    }
    if (module === 'toast' && part === 'Root' && (!attrs.has('render') || !importsMotionElements)) {
      report(node, `${name} must be rendered as a Motion element so toasts animate in and out`);
    }
    if (COLLAPSIBLE_MODULES.has(module) && part === 'Panel') {
      const className = attrs.get('className')?.getText() ?? '';
      const ok =
        className.includes(`--${module}-panel-height`) &&
        className.includes('data-starting-style:') &&
        className.includes('data-ending-style:') &&
        className.includes('duration-[var(--motion-');
      if (!ok) {
        report(node, `${name} must transition height from --${module}-panel-height with data-starting/ending-style on a motion token`);
      }
    }
  }

  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) visitElement(node);

    if (!insideMotionModule) {
      if (ts.isStringLiteralLike(node) && LITERAL_TIMING.test(node.text)) {
        report(node, 'use duration-[var(--motion-fast|standard|slow)] and ease-standard instead of literal timing');
      }
      if (ts.isJsxAttribute(node) && MOTION_PROPS.has(node.name.getText())) {
        node.forEachChild(function findLiteral(child: ts.Node) {
          if (
            ts.isPropertyAssignment(child) &&
            ['duration', 'delay', 'ease', 'stiffness', 'damping'].includes(child.name.getText()) &&
            !ts.isIdentifier(child.initializer) &&
            !ts.isPropertyAccessExpression(child.initializer)
          ) {
            report(child, 'Motion timing comes from motionPresets / motionDuration, not inline literals');
          }
          child.forEachChild(findLiteral);
        });
      }
    }

    if (ts.isJsxElement(node)) {
      ancestors.push(node.openingElement.tagName.getText());
      node.forEachChild(visit);
      ancestors.pop();
      return;
    }
    node.forEachChild(visit);
  }
  visit(source);
  return violations;
}

describe('motion contract', () => {
  it('every popout, overlay, toast and collapsible in packages/ui and the web apps is animated on tokens', () => {
    const files = SCANNED_DIRS.flatMap(collectSources);
    expect(files.length).toBeGreaterThan(50);
    const violations = files.flatMap((file) => checkSource(file, readFileSync(file, 'utf-8')));
    expect(violations.map((v) => `${v.file}:${v.line} ${v.rule}`)).toEqual([]);
  });

  describe('detects violations', () => {
    const file = join(REPO_ROOT, 'apps/workspace/src/example.tsx');

    it('an un-animated Base UI popup, portal and toast', () => {
      const rules = checkSource(
        file,
        `import { Popover } from '@base-ui/react/popover';
         import { Toast } from '@base-ui/react/toast';
         export const X = () => (
           <Popover.Root>
             <Popover.Portal><Popover.Positioner><Popover.Popup>Hi</Popover.Popup></Popover.Positioner></Popover.Portal>
             <Toast.Root toast={t} />
           </Popover.Root>
         );`,
      ).map((v) => v.rule);
      expect(rules).toHaveLength(3);
      expect(rules.join('\n')).toMatch(/Popover\.Popup must be rendered as a Motion element/);
      expect(rules.join('\n')).toMatch(/Popover\.Portal must sit inside <AnimatePresence>/);
      expect(rules.join('\n')).toMatch(/Toast\.Root must be rendered as a Motion element/);
    });

    it('a portal inside AnimatePresence without keepMounted', () => {
      const rules = checkSource(
        file,
        `import { Dialog } from '@base-ui/react/dialog';
         import { AnimatePresence, m } from '@nestself/ui';
         export const X = ({ open }) => (
           <AnimatePresence>{open && <Dialog.Portal><Dialog.Popup render={<m.div />} /></Dialog.Portal>}</AnimatePresence>
         );`,
      ).map((v) => v.rule);
      expect(rules).toEqual([expect.stringMatching(/needs keepMounted/)]);
    });

    it('an accordion panel that snaps open', () => {
      const rules = checkSource(
        file,
        `import { Accordion } from '@base-ui/react/accordion';
         export const X = () => <Accordion.Panel className="pb-4">Body</Accordion.Panel>;`,
      ).map((v) => v.rule);
      expect(rules).toEqual([expect.stringMatching(/--accordion-panel-height/)]);
    });

    it('literal timing in classes and Motion props, and framer-motion imports', () => {
      const rules = checkSource(
        file,
        `import { motion } from 'framer-motion';
         import { m } from 'motion/react';
         export const X = () => (
           <>
             <div className="transition-opacity duration-300 md:ease-[cubic-bezier(0,0,1,1)]" />
             <m.div animate={{ opacity: 1, transition: { duration: 0.4 } }} />
           </>
         );`,
      ).map((v) => v.rule);
      expect(rules).toEqual([
        expect.stringMatching(/not framer-motion/),
        expect.stringMatching(/apps import Motion through @nestself\/ui/),
        expect.stringMatching(/literal timing/),
        expect.stringMatching(/not inline literals/),
      ]);
    });

    it('accepts the compliant patterns', () => {
      const rules = checkSource(
        file,
        `import { Menu } from '@base-ui/react/menu';
         import { AnimatePresence, m, useMotionPreset } from '@nestself/ui';
         export const X = ({ open }) => (
           <AnimatePresence>
             {open && (
               <Menu.Portal keepMounted>
                 <Menu.Positioner>
                   <Menu.Popup className="duration-[var(--motion-fast)] ease-standard" render={<m.div {...useMotionPreset('popover')} />} />
                 </Menu.Positioner>
               </Menu.Portal>
             )}
           </AnimatePresence>
         );`,
      );
      expect(rules).toEqual([]);
    });
  });
});
