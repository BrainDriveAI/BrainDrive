import { diagnostic } from './diagnostics.mjs';

function pointer(root, reference) {
  if (!reference.startsWith('#/')) return null;
  return reference.slice(2).split('/').reduce((value, part) => value?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], root);
}

function typeMatches(type, value) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function matchesCondition(node, value) {
  if (!node || typeof node !== 'object') return true;
  if (node.allOf && !node.allOf.every((child) => matchesCondition(child, value))) return false;
  if (node.const !== undefined && value !== node.const) return false;
  if (node.enum && !node.enum.includes(value)) return false;
  if (node.type && !typeMatches(node.type, value)) return false;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if ((node.required || []).some((key) => !(key in value))) return false;
    for (const [key, child] of Object.entries(node.properties || {})) {
      if (key in value && !matchesCondition(child, value[key])) return false;
    }
  }
  return true;
}

export function validateSchema(schema, value, path = 'value', { rule = 'DA-18' } = {}) {
  const diagnostics = [];
  function visit(node, current, currentPath) {
    if (!node || typeof node !== 'object') return;
    if (node.$ref) {
      const target = pointer(schema, node.$ref);
      if (!target) diagnostics.push(diagnostic(rule, currentPath, `schema reference cannot be resolved: ${node.$ref}`));
      else visit(target, current, currentPath);
      return;
    }
    if (node.allOf) for (const child of node.allOf) visit(child, current, currentPath);
    if (node.if) {
      const conditionApplies = matchesCondition(node.if, current);
      if (conditionApplies && node.then) visit(node.then, current, currentPath);
      if (!conditionApplies && node.else) visit(node.else, current, currentPath);
    }
    if (node.not && validateSchema({ ...schema, ...node.not }, current, currentPath, { rule }).length === 0) diagnostics.push(diagnostic(rule, currentPath, 'value matches a prohibited schema'));
    if (node.const !== undefined && current !== node.const) diagnostics.push(diagnostic(rule, currentPath, 'value does not match the required constant'));
    if (node.enum && !node.enum.includes(current)) diagnostics.push(diagnostic(rule, currentPath, 'value is outside the allowed vocabulary'));
    if (node.type && !typeMatches(node.type, current)) {
      diagnostics.push(diagnostic(rule, currentPath, `value must be ${node.type}`));
      return;
    }
    if (typeof current === 'string' && node.pattern) {
      try { if (!new RegExp(node.pattern).test(current)) diagnostics.push(diagnostic(rule, currentPath, 'string does not match the required pattern')); }
      catch { diagnostics.push(diagnostic(rule, currentPath, 'schema contains an invalid pattern')); }
    }
    if (Array.isArray(current)) {
      if (node.minItems !== undefined && current.length < node.minItems) diagnostics.push(diagnostic(rule, currentPath, `array must contain at least ${node.minItems} items`));
      if (node.maxItems !== undefined && current.length > node.maxItems) diagnostics.push(diagnostic(rule, currentPath, `array must contain at most ${node.maxItems} items`));
      if (node.items) current.forEach((item, index) => visit(node.items, item, `${currentPath}[${index}]`));
    }
    if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
      for (const required of node.required || []) if (!(required in current)) diagnostics.push(diagnostic(rule, currentPath, `object is missing required property ${required}`));
      for (const [key, child] of Object.entries(node.properties || {})) if (key in current) visit(child, current[key], `${currentPath}.${key}`);
    }
  }
  visit(schema, value, path);
  return diagnostics;
}
