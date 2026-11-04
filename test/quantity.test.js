'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'common.js'), 'utf8');

function loadApp() {
  const sandbox = {
    document: {
      body: { insertAdjacentHTML() {} },
      getElementById() { return null; },
      querySelector() { return null; },
      createElement() { return {}; }
    },
    navigator: { onLine: true },
    location: { search: '' },
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = function () {};
  sandbox.removeEventListener = function () {};
  sandbox.dispatchEvent = function () {};
  vm.runInNewContext(source, sandbox, { filename: 'public/js/common.js' });
  return sandbox.App;
}

const App = loadApp();

const productStock = {
  min: 0,
  max: 1000000,
  emptyMessage: 'Enter the quantity to add.',
  negativeMessage: 'Quantity cannot be negative.',
  decimalMessage: 'Enter a whole number (no decimals).',
  invalidMessage: 'Enter a whole number, 0 or more.',
  minMessage: 'Quantity cannot be negative.',
  maxMessage: 'Quantity must be 1,000,000 or less.'
};

function posQuantity(raw, max) {
  return App.wholeNumber(raw, {
    min: 1,
    max,
    emptyMessage: 'Enter a quantity of 1 or more.',
    negativeMessage: 'Quantity cannot be negative.',
    decimalMessage: 'Enter a whole number (no decimals).',
    invalidMessage: 'Enter a whole number of 1 or more.',
    minMessage: 'Quantity must be at least 1.',
    maxMessage: 'Only ' + max + ' in stock.'
  });
}

test('accepts typed positive whole quantities', () => {
  for (const value of ['1', '10', '50', '100']) {
    assert.equal(App.wholeNumber(value, productStock).value, Number(value));
    assert.equal(posQuantity(value, 100).value, Number(value));
  }
});

test('product stock accepts zero but rejects empty, negative, decimal, and invalid input', () => {
  assert.equal(App.wholeNumber('0', productStock).value, 0);
  assert.equal(App.wholeNumber('', productStock).code, 'empty');
  assert.equal(App.wholeNumber('-1', productStock).code, 'negative');
  assert.equal(App.wholeNumber('1.5', productStock).code, 'decimal');
  assert.equal(App.wholeNumber('abc', productStock).code, 'invalid');
  assert.equal(App.wholeNumber('1e2', productStock).code, 'invalid');
});

test('POS quantities require at least one whole unit', () => {
  assert.equal(posQuantity('0', 10).code, 'min');
  assert.equal(posQuantity('-2', 10).code, 'negative');
  assert.equal(posQuantity('2.5', 10).code, 'decimal');
  assert.equal(posQuantity('', 10).code, 'empty');
  assert.equal(posQuantity('1', 10).value, 1);
});

test('stock limits are enforced with the caller message', () => {
  const over = posQuantity('11', 10);
  assert.equal(over.code, 'max');
  assert.equal(over.error, 'Only 10 in stock.');
  assert.equal(posQuantity('10', 10).value, 10);

  const productOver = App.wholeNumber('1000001', productStock);
  assert.equal(productOver.code, 'max');
  assert.equal(productOver.error, 'Quantity must be 1,000,000 or less.');
});

test('whitespace and leading zeros are normalized', () => {
  assert.equal(App.wholeNumber(' 010 ', productStock).value, 10);
  assert.equal(posQuantity(' 007 ', 10).value, 7);
});
