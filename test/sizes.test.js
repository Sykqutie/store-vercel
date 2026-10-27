'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sizes = require('../lib/sizes');

test('parses explicit unit sizes from item names', () => {
  const cases = [
    ['Coca-Cola 1.5L', 1.5, 'L', '1.5 L'],
    ['Coke 500ml', 500, 'mL', '500 mL'],
    ['Milo 300 g', 300, 'g', '300 g'],
    ['Rice 25kg', 25, 'kg', '25 kg'],
    ['Tablet 250 mg', 250, 'mg', '250 mg'],
    ['Eggs 12 pcs', 12, 'pcs', '12 pcs'],
    ['Coffee 1 sachet', 1, 'sachet', '1 sachet'],
    ['Sachet 12 mL sachet', 12, 'mL', '12 mL sachet'],
    ['Sachet 12mL SACHET', 12, 'mL', '12 mL sachet'],
    ['Cream 0.05 L', 0.05, 'L', '0.05 L']
  ];
  for (const [name, value, unit, label] of cases) {
    assert.deepEqual(sizes.fromName(name), { value, unit, label }, name);
  }
});

test('normalizes supported unit aliases', () => {
  const cases = [
    ['milliliter', 'mL'], ['milliliters', 'mL'], ['millilitre', 'mL'], ['millilitres', 'mL'],
    ['liter', 'L'], ['liters', 'L'], ['litre', 'L'], ['litres', 'L'],
    ['gram', 'g'], ['grams', 'g'], ['kilogram', 'kg'], ['kilograms', 'kg'],
    ['milligram', 'mg'], ['milligrams', 'mg'], ['pc', 'pcs'], ['piece', 'pcs'],
    ['pieces', 'pcs'], ['sachet', 'sachet'], ['sachets', 'sachet']
  ];
  for (const [alias, unit] of cases) assert.equal(sizes.normalizeUnit(alias), unit, alias);
  assert.equal(sizes.normalizeUnit('bottle'), null);
});

test('does not guess from brands, barcodes, categories, or bare numbers', () => {
  const cases = [
    'Coca-Cola',
    '7-Eleven Big Gulp',
    '4800123456789',
    'Mystery item 500',
    'Product 3-in-1',
    'Item 12 pack',
    'No size here'
  ];
  for (const name of cases) assert.equal(sizes.fromName(name), null, name);
});

test('rejects ambiguous names with multiple different explicit sizes', () => {
  assert.equal(sizes.fromName('Bundle 500 mL and 1 L'), null);
  assert.equal(sizes.fromName('500mL (12 sachet)'), null);
  assert.deepEqual(sizes.fromName('Buy 1 L get 1 L'), { value: 1, unit: 'L', label: '1 L' });
});

test('ignores multipliers and still reads one product size', () => {
  assert.deepEqual(sizes.fromName('500 mL x 12'), { value: 500, unit: 'mL', label: '500 mL' });
  assert.deepEqual(sizes.fromName('3-in-1 Coffee 30g'), { value: 30, unit: 'g', label: '30 g' });
});

test('cleanSize validates owner-entered structured sizes', () => {
  assert.deepEqual(sizes.cleanSize(500, 'ml', ''), { value: 500, unit: 'mL', label: '500 mL' });
  assert.deepEqual(sizes.cleanSize('1.5', 'L', ''), { value: 1.5, unit: 'L', label: '1.5 L' });
  assert.deepEqual(sizes.cleanSize(12, 'mL', '12 mL sachet'), { value: 12, unit: 'mL', label: '12 mL sachet' });
  assert.deepEqual(sizes.cleanSize('12', 'mL', '  12   mL   sachet  '), { value: 12, unit: 'mL', label: '12 mL sachet' });
  assert.equal(sizes.cleanSize('', '', ''), null);
  assert.equal(sizes.cleanSize(null, null, null), null);
  assert.equal(sizes.cleanSize(500, '', ''), undefined);
  assert.equal(sizes.cleanSize('', 'mL', ''), undefined);
  assert.equal(sizes.cleanSize('', '', '500 mL'), undefined);
  assert.equal(sizes.cleanSize(0, 'mL', ''), undefined);
  assert.equal(sizes.cleanSize(-1, 'mL', ''), undefined);
  assert.equal(sizes.cleanSize('abc', 'mL', ''), undefined);
  assert.equal(sizes.cleanSize(500, 'bottle', ''), undefined);
  assert.equal(sizes.cleanSize(500, 'mL', 'x'.repeat(61)), undefined);
  assert.equal(sizes.cleanSize(1e8, 'mL', ''), undefined);
  assert.equal(sizes.cleanSize(0.0004, 'L', ''), undefined);
  assert.deepEqual(sizes.cleanSize(1.2345, 'L', ''), { value: 1.235, unit: 'L', label: '1.235 L' });
  assert.deepEqual(sizes.cleanSize(9999999.999, 'mL', ''), { value: 9999999.999, unit: 'mL', label: '9999999.999 mL' });
  assert.equal(sizes.cleanSize(10000000, 'mL', ''), undefined);
  assert.equal(sizes.fromName('Tiny 0.0004 L'), null);
  assert.equal(sizes.fromName('Huge 10000000 mL'), null);
  assert.deepEqual(sizes.fromName('Huge 9999999.999 mL'), { value: 9999999.999, unit: 'mL', label: '9999999.999 mL' });
});

test('exports the display fallback and supported units', () => {
  assert.equal(sizes.FALLBACK_LABEL, 'Size not specified');
  assert.deepEqual(sizes.SUPPORTED_UNITS, ['mL', 'L', 'g', 'kg', 'mg', 'pcs', 'sachet']);
});
