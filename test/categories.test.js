'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const categories = require('../lib/categories');

test('default categories include the protected fallback', () => {
  assert.ok(categories.DEFAULT_CATEGORIES.includes(categories.FALLBACK_CATEGORY));
  assert.ok(categories.DEFAULT_CATEGORIES.includes('General'));
  assert.equal(new Set(categories.DEFAULT_CATEGORIES.map((name) => name.toLowerCase())).size, categories.DEFAULT_CATEGORIES.length);
});

test('cleanName trims, collapses spaces, and enforces the limit', () => {
  assert.equal(categories.cleanName('  Canned   Goods '), 'Canned Goods');
  assert.equal(categories.cleanName('   '), null);
  assert.equal(categories.cleanName('x'.repeat(60)), 'x'.repeat(60));
  assert.equal(categories.cleanName('x'.repeat(61)), null);
  assert.equal(categories.cleanName(null), null);
});

test('normalize is case-insensitive and punctuation-tolerant', () => {
  assert.equal(categories.normalize('  Café & Cream!! '), 'cafe cream');
  assert.equal(categories.normalize('Coca-Cola'), 'coca cola');
});

test('classifies common store products by keyword', () => {
  const cases = [
    ['Safeguard Bath Soap 90g', 'Hygiene'],
    ['Dove Shampoo', 'Hygiene'],
    ['Colgate Toothpaste', 'Hygiene'],
    ['Joy Dishwashing Liquid', 'Household'],
    ['Downy Fabric Conditioner', 'Household'],
    ['Ariel Detergent Powder', 'Household'],
    ['Coca-Cola 1.5L', 'Beverages'],
    ['Milo Chocolate Drink', 'Beverages'],
    ['Milk Tea', 'Beverages'],
    ['Bear Brand Milk', 'Dairy'],
    ['Eggs', 'Dairy'],
    ['Lucky Me Pancit Canton', 'Noodles'],
    ['Del Monte Tomato Sauce', 'Canned Goods'],
    ['Argentina Corned Beef', 'Canned Goods'],
    ['Pandesal', 'Bakery'],
    ['Skyflakes Crackers', 'Snacks'],
    ['Piattos Chips', 'Snacks'],
    ['Cetaphil Moisturizer', 'Skin Care'],
    ['Biore Facial Wash', 'Skin Care']
  ];
  for (const [name, expected] of cases) {
    assert.equal(categories.classifyName(name), expected, name);
  }
});

test('longer keywords win over shorter overlapping ones', () => {
  assert.equal(categories.classifyName('Joy Dish Soap'), 'Household');
  assert.equal(categories.classifyName('Downy Fabric Softener'), 'Household');
  assert.equal(categories.classifyName('Chocolate Drink'), 'Beverages');
  assert.equal(categories.classifyName('Milk Tea'), 'Beverages');
});

test('unknown or empty names fall back safely', () => {
  assert.equal(categories.classifyName('Unknown Item XYZ'), categories.FALLBACK_CATEGORY);
  assert.equal(categories.classifyName(''), categories.FALLBACK_CATEGORY);
  assert.equal(categories.classifyName(null), categories.FALLBACK_CATEGORY);
});
