'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const productIcons = require('../public/js/product-icons.js');
const root = path.join(__dirname, '..');

test('product icon picks match common SmartMart items', () => {
  const cases = [
    ['Beverages', 'Bottled Water', 'bottle'],
    ['Beverages', 'Soft Drinks', 'can'],
    ['Beverages', 'Coca-Cola 1.5L', 'can'],
    ['Beverages', 'Chocolate Drink', 'bottle'],
    ['Canned Goods', 'Sardines', 'tin'],
    ['Canned Goods', 'Canned Tuna', 'tin'],
    ['Hygiene', 'Shampoo', 'shampoo'],
    ['Hygiene', 'Bath Soap', 'soap'],
    ['Hygiene', 'Antibacterial Wipes', 'wipes'],
    ['Household', 'Dishwashing Liquid', 'clean'],
    ['Household', 'Dish Soap', 'clean'],
    ['Household', 'Calla', 'detergent'],
    ['Snacks', 'Potato Chips', 'snack'],
    ['Snacks', 'Rice Crackers', 'snack'],
    ['Snacks', 'Chocolate Snacks', 'chocolate'],
    ['Noodles', 'Instant Noodles', 'noodles'],
    ['Rice', 'Jasmine Rice', 'rice'],
    ['Medicine', 'Paracetamol', 'health'],
    ['Skin Care', 'Body Lotion', 'care'],
    ['Skin Care', 'Cetaphil', 'skincare'],
    ['Skin Care', 'Acne Powder', 'acne'],
    ['Skin Care', 'Acne Mud Powder', 'acne'],
    ['Baby Care', 'Baby Cologne', 'cologne'],
    ['Health & Personal Care', 'Baby Bench Colonia', 'cologne'],
    ['Household & Cleaning', 'Calla', 'detergent'],
    ['Household & Cleaning', 'Downy', 'detergent'],
    ['Health & Personal Care', 'ANTIBACTERIAL CLEANSING WIPES', 'wipes'],
    ['Canned Goods', 'Century Tuna', 'tin'],
    ['Beverages', 'Coca-Cola Can', 'can'],
    ['Beverages', 'ChocoMocho', 'chocolate'],
    ['Beverages', 'Coffee Sachet 3-in-1', 'coffee'],
    ['Beverages', 'White Bread Loaf', 'bread'],
    ['Hygiene', 'head & shoulder COOL MENTOl', 'shampoo'],
    ['General', 'Keratin', 'shampoo'],
    ['Health & Personal Care', 'Colgate Classic Deep Clean', 'toothpaste'],
    ['Health & Personal Care', 'Sister Pantyliners', 'sanitary'],
    ['General', 'Ethyl Alcohol', 'sanitizer'],
    ['Pantry/Packed Foods', 'Marie', 'snack'],
    ['Health & Personal Care', 'Dazzle Me get a grip', 'care'],
    ['Skin Care', 'Tomato Glass Skin', 'care'],
    ['Skin Care', 'Olay natural aura', 'care'],
    ['Hygiene', 'Geisha White Extra Moisture', 'soap'],
    ['Dairy', 'Fresh Milk', 'dairy'],
    ['Bakery', 'Pandesal', 'bread'],
    ['Uncategorized', 'Mystery Item', 'box'],
    ['Uncategorized', 'BB', 'box'],
    ['Uncategorized', 'C', 'box'],
    ['Uncategorized', 'AC', 'box']
  ];
  for (const [category, name, expected] of cases) {
    assert.equal(productIcons.kind(category, name), expected, `${name} (${category})`);
  }
});

test('the requested product illustrations exist as distinct icon kinds', () => {
  const required = [
    'bottle', 'cologne', 'detergent', 'wipes', 'acne',
    'tin', 'skincare', 'chocolate', 'can', 'shampoo', 'soap'
  ];
  for (const key of required) {
    assert.ok(productIcons.icons[key], `${key} illustration exists`);
    assert.match(productIcons.icons[key], /class="pi-(a|b|c|d|e)"/, `${key} has colour depth`);
  }
  assert.notEqual(productIcons.icons.bottle, productIcons.icons.can);
  assert.notEqual(productIcons.icons.cologne, productIcons.icons.skincare);
  assert.notEqual(productIcons.icons.wipes, productIcons.icons.hygiene);
  assert.notEqual(productIcons.icons.acne, productIcons.icons.tin);
});

test('icons work from a name alone or a category alone', () => {
  assert.equal(productIcons.kind('', 'Bottled Water'), 'bottle');
  assert.equal(productIcons.kind(null, 'Paracetamol'), 'health');
  assert.equal(productIcons.kind('Bakery', ''), 'bread');
  assert.equal(productIcons.kind(undefined, undefined), 'box');
  assert.equal(productIcons.kind('', 'Calla'), 'detergent');
  assert.equal(productIcons.kind('', 'Cetaphil'), 'skincare');
  assert.equal(productIcons.kind('', 'Baby Cologne'), 'cologne');
  assert.equal(productIcons.kind('', 'Antibacterial Wipes'), 'wipes');
  assert.equal(productIcons.kind('', 'Acne Powder'), 'acne');
  assert.equal(productIcons.kind('', 'Chocolate Snacks'), 'chocolate');
  assert.equal(productIcons.kind('', 'Soft Drinks'), 'can');
  assert.equal(productIcons.kind('', 'Shampoo'), 'shampoo');
  assert.equal(productIcons.kind('', 'Bath Soap'), 'soap');
});

test('category fallbacks always resolve to an illustrated icon', () => {
  const cases = {
    Beverages: 'bottle',
    'Canned Goods': 'tin',
    Rice: 'rice',
    Snacks: 'snack',
    Medicine: 'health',
    Noodles: 'noodles',
    Dairy: 'dairy',
    Bakery: 'bread',
    Hygiene: 'hygiene',
    Household: 'clean',
    'Household & Cleaning': 'clean',
    'Health & Personal Care': 'hygiene',
    'Skin Care': 'care',
    Laundry: 'detergent',
    'Pantry/Packed Foods': 'snack',
    Baby: 'baby',
    Pet: 'pet',
    Frozen: 'frozen',
    Condiments: 'condiment',
    Coffee: 'coffee',
    General: 'box',
    Uncategorized: 'box'
  };
  for (const [category, expected] of Object.entries(cases)) {
    assert.equal(productIcons.kind(category, ''), expected, category);
  }
  for (const name of ['BB', 'C', 'AC', '???', '', null]) {
    const kind = productIcons.kind('Uncategorized', name);
    assert.ok(productIcons.icons[kind], `${name} resolves to ${kind}`);
    assert.notEqual(kind, 'letters');
  }
});

test('product icon HTML is self-contained and uses the shared container', () => {
  const normal = productIcons.html('Beverages', 'Bottled Water');
  assert.match(normal, /^<span class="pi" data-icon="bottle" aria-hidden="true"><svg /);
  assert.match(normal, /viewBox="0 0 32 32"/);
  assert.doesNotMatch(normal, /https?:/);

  const small = productIcons.html('Household', 'Dishwashing Liquid', { small: true });
  assert.match(small, /^<span class="pi sm" data-icon="clean"/);
});

test('every product icon is a reusable inline SVG with 3D shading and no text', () => {
  for (const [name, svg] of Object.entries(productIcons.icons)) {
    assert.match(svg, /^<svg /, name);
    assert.match(svg, /viewBox="0 0 32 32"/, name);
    assert.match(svg, /<\/svg>$/, name);
    assert.doesNotMatch(svg, /https?:/, name);
    assert.doesNotMatch(svg, /<(text|image|foreignObject)\b/i, name);
    assert.ok((svg.match(/class="pi-[abcde]"/g) || []).length >= 2, `${name} has depth shading`);
    assert.match(svg, /class="pi-[ls]"/, `${name} has highlight or outline detail`);
  }
});

test('product icons are wired into every product surface and the offline shell', () => {
  const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  assert.match(sw, /'\/js\/product-icons\.js'/);
  assert.match(sw, /'\/js\/product-icons\.js\?v=20261103'/);
  for (const page of ['pos', 'products', 'edit-product', 'report', 'dashboard']) {
    const html = fs.readFileSync(path.join(root, `public/html/${page}.html`), 'utf8');
    assert.match(html, /\/js\/product-icons\.js/, `${page}.html loads product icons`);
  }
});

test('product surfaces use automatic icons instead of uploaded images or initials', () => {
  for (const script of ['pos', 'products', 'edit-product', 'report', 'dashboard']) {
    const js = fs.readFileSync(path.join(root, `public/js/${script}.js`), 'utf8');
    assert.match(js, /productIcon/, `${script}.js renders a product icon`);
    assert.doesNotMatch(js, /image_url|pc-img|class="hx"|initials/i, `${script}.js has no image or letter placeholder dependency`);
    assert.doesNotMatch(js, /<img\b|type="file"|accept="image/i, `${script}.js has no product image element`);
  }
  for (const script of ['products', 'edit-product']) {
    const js = fs.readFileSync(path.join(root, `public/js/${script}.js`), 'utf8');
    assert.match(js, /iconPreview/, `${script}.js has a live icon preview`);
  }
  assert.equal(fs.existsSync(path.join(root, 'public/js/pos.js.bak')), false, 'old initials backup removed');
  const css = fs.readFileSync(path.join(root, 'public/css/app.css'), 'utf8');
  assert.doesNotMatch(css, /\.hx\b|\.pc-img\b/, 'old placeholder styles removed');
});
