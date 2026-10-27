'use strict';

// Explicit size parsing only. A size is recognized when a number is directly
// followed by a supported unit; brands, categories, barcodes, and bare numbers
// are deliberately ignored.
const SUPPORTED_UNITS = ['mL', 'L', 'g', 'kg', 'mg', 'pcs', 'sachet'];
const FALLBACK_LABEL = 'Size not specified';
const MIN_VALUE = 0.001;
const MAX_VALUE = 9999999.999;

const UNIT_ALIASES = new Map([
  ['ml', 'mL'],
  ['milliliter', 'mL'],
  ['milliliters', 'mL'],
  ['millilitre', 'mL'],
  ['millilitres', 'mL'],
  ['l', 'L'],
  ['liter', 'L'],
  ['liters', 'L'],
  ['litre', 'L'],
  ['litres', 'L'],
  ['g', 'g'],
  ['gram', 'g'],
  ['grams', 'g'],
  ['kg', 'kg'],
  ['kilogram', 'kg'],
  ['kilograms', 'kg'],
  ['mg', 'mg'],
  ['milligram', 'mg'],
  ['milligrams', 'mg'],
  ['pc', 'pcs'],
  ['pcs', 'pcs'],
  ['piece', 'pcs'],
  ['pieces', 'pcs'],
  ['sachet', 'sachet'],
  ['sachets', 'sachet']
]);

const UNIT_PATTERN = 'millilit(?:er|re)s?|lit(?:er|re)s?|kilograms?|milligrams?|grams?|sachets?|pcs?|ml|kg|mg|g|l';
const SIZE_RE = new RegExp(
  '(^|[^\\p{L}\\p{N}])(\\d+(?:\\.\\d+)?)\\s*(' + UNIT_PATTERN + ')(?=$|[^\\p{L}\\p{N}])',
  'giu'
);
const SACHET_AFTER_RE = /^\s+(sachets?)(?=$|[^\p{L}\p{N}])/iu;

function normalizeUnit(value) {
  const key = String(value == null ? '' : value).trim().toLowerCase();
  return UNIT_ALIASES.get(key) || null;
}

function roundValue(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function formatValue(value) {
  const fixed = Number(value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return fixed || '0';
}

function cleanLabel(value) {
  const label = String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  if (!label || label.length > 60) return null;
  return label;
}

function makeLabel(value, unit) {
  return formatValue(value) + ' ' + unit;
}

// Returns { value, unit, label } or null when the name has no unambiguous
// explicit size. Multiple distinct explicit sizes are rejected rather than
// guessing which one is the product size.
function fromName(name) {
  const text = String(name == null ? '' : name);
  if (!text) return null;
  const matches = [];
  SIZE_RE.lastIndex = 0;
  let match;
  while ((match = SIZE_RE.exec(text)) !== null) {
    const value = roundValue(match[2]);
    const unit = normalizeUnit(match[3]);
    if (!unit || !Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE) continue;
    const after = text.slice(match.index + match[0].length);
    const packaging = SACHET_AFTER_RE.exec(after);
    const label = makeLabel(value, unit) + (packaging ? ' ' + packaging[1].toLowerCase() : '');
    matches.push({ value, unit, label });
  }
  if (!matches.length) return null;
  const unique = [];
  const seen = new Set();
  for (const size of matches) {
    const key = size.value + '|' + size.unit + '|' + size.label;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(size);
    }
  }
  return unique.length === 1 ? unique[0] : null;
}

// Parses owner-submitted structured size fields. `null` means "no size";
// `undefined` means invalid input. Blank label is derived from value + unit.
function cleanSize(value, unit, label) {
  const hasValue = value !== undefined && value !== null && String(value).trim() !== '';
  const hasUnit = unit !== undefined && unit !== null && String(unit).trim() !== '';
  const rawLabel = String(label == null ? '' : label).trim();

  if (!hasValue && !hasUnit) {
    return rawLabel ? undefined : null;
  }
  if (!hasValue || !hasUnit) return undefined;

  const n = roundValue(value);
  const normalizedUnit = normalizeUnit(unit);
  if (!Number.isFinite(n) || n < MIN_VALUE || n > MAX_VALUE || !normalizedUnit) return undefined;

  const text = cleanLabel(rawLabel || makeLabel(n, normalizedUnit));
  if (!text) return undefined;
  return { value: n, unit: normalizedUnit, label: text };
}

module.exports = {
  SUPPORTED_UNITS,
  FALLBACK_LABEL,
  normalizeUnit,
  makeLabel,
  fromName,
  cleanSize
};
