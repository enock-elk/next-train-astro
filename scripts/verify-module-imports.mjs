/**
 * Guards against the class of bug where a module ported from the SPA references
 * a name that used to be a script-scope global (config constants, util helpers)
 * but is now module-scoped and was never imported. Those only blow up at runtime,
 * on the exact device paths that are hardest to test (geolocation, offline, WebView).
 *
 * Run: node scripts/verify-module-imports.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, 'src', 'lib');

/** Files that are raw fragments, not real modules. */
const SKIP_DIRS = new Set(['_extract']);

const failures = [];

function parse(code, file) {
  try {
    return acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (err) {
    failures.push(`${file}: parse error — ${err.message}`);
    return null;
  }
}

/** Names a module exports (for building the "provider" catalogue). */
function collectExports(ast) {
  const names = new Set();
  for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        if (node.declaration.type === 'VariableDeclaration') {
          for (const d of node.declaration.declarations) {
            if (d.id.type === 'Identifier') names.add(d.id.name);
          }
        } else if (node.declaration.id) {
          names.add(node.declaration.id.name);
        }
      }
      for (const s of node.specifiers) names.add(s.exported.name);
    }
  }
  return names;
}

/** Every binding introduced anywhere in the module (imports, decls, params, catch). */
function collectBindings(ast) {
  const names = new Set();
  const addPattern = (pat) => {
    if (!pat) return;
    switch (pat.type) {
      case 'Identifier': names.add(pat.name); break;
      case 'ObjectPattern': pat.properties.forEach((p) => addPattern(p.value || p.argument)); break;
      case 'ArrayPattern': pat.elements.forEach(addPattern); break;
      case 'AssignmentPattern': addPattern(pat.left); break;
      case 'RestElement': addPattern(pat.argument); break;
      default: break;
    }
  };

  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'ImportDeclaration': node.specifiers.forEach((s) => names.add(s.local.name)); break;
      case 'VariableDeclarator': addPattern(node.id); break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) names.add(node.id.name);
        node.params.forEach(addPattern);
        break;
      case 'ClassDeclaration': if (node.id) names.add(node.id.name); break;
      case 'CatchClause': addPattern(node.param); break;
      default: break;
    }
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child.type === 'string') walk(child);
    }
  };
  walk(ast);
  return names;
}

/** Identifier reads, skipping property keys / member accessors / labels. */
function collectReferences(ast) {
  const refs = new Map();
  const walk = (node, parent, key) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Identifier') {
      const isMemberProp = parent?.type === 'MemberExpression' && key === 'property' && !parent.computed;
      const isPropKey = parent?.type === 'Property' && key === 'key' && !parent.computed;
      const isSpecifier = parent?.type?.startsWith('Import') || parent?.type?.startsWith('Export');
      if (!isMemberProp && !isPropKey && !isSpecifier && !refs.has(node.name)) {
        refs.set(node.name, node.loc.start.line);
      }
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'loc' || k === 'start' || k === 'end') continue;
      const child = node[k];
      if (Array.isArray(child)) child.forEach((c) => walk(c, node, k));
      else if (child && typeof child.type === 'string') walk(child, node, k);
    }
  };
  walk(ast, null, null);
  return refs;
}

const files = readdirSync(LIB, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.js'))
  .map((e) => join(LIB, e.name));

// Catalogue: which sibling module exports which name.
const providers = new Map();
const parsed = new Map();
for (const file of files) {
  if (SKIP_DIRS.has(basename(dirname(file)))) continue;
  const ast = parse(readFileSync(file, 'utf8'), file);
  if (!ast) continue;
  parsed.set(file, ast);
  for (const name of collectExports(ast)) {
    if (!providers.has(name)) providers.set(name, basename(file));
  }
}

for (const [file, ast] of parsed) {
  const bound = collectBindings(ast);
  for (const [name, line] of collectReferences(ast)) {
    if (bound.has(name)) continue;
    const owner = providers.get(name);
    // Only flag names a sibling module actually exports: those are unambiguous
    // missing imports rather than intentional browser/globalThis lookups.
    if (owner && owner !== basename(file)) {
      failures.push(`${basename(file)}:${line} — '${name}' is used but not imported (exported by ${owner})`);
    }
  }
}

if (failures.length) {
  console.error('Module import check FAILED:\n' + failures.map((f) => '  ✗ ' + f).join('\n'));
  process.exit(1);
}
console.log(`Module import check passed (${parsed.size} modules).`);
