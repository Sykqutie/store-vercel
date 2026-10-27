'use strict';

const FALLBACK_CATEGORY = 'Uncategorized';

const DEFAULT_CATEGORIES = [
  'Beverages',
  'Noodles',
  'Snacks',
  'Canned Goods',
  'Bakery',
  'Dairy',
  'Hygiene',
  'Household',
  'Skin Care',
  'General',
  FALLBACK_CATEGORY
];

const KEYWORD_RULES = [
  {
    category: 'Skin Care',
    keywords: [
      'skin care', 'skincare', 'cetaphil', 'olay', 'keratin', 'glass skin', 'acne',
      'facial wash', 'face wash', 'moisturizer', 'moisturiser', 'serum', 'sunscreen',
      'toner', 'cleanser', 'retinol', 'collagen', 'body lotion', 'hand cream'
    ]
  },
  {
    category: 'Hygiene',
    keywords: [
      'shampoo', 'conditioner', 'soap', 'toothpaste', 'toothbrush', 'deodorant',
      'sanitary napkin', 'sanitary pad', 'diaper', 'tissue', 'cotton buds', 'alcohol',
      'ethyl alcohol', 'sanitizer', 'antiseptic', 'bandage', 'lotion', 'body wash',
      'bath soap', 'razor', 'shaving cream'
    ]
  },
  {
    category: 'Household',
    keywords: [
      'detergent', 'bleach', 'dishwashing', 'dish washing', 'dish soap',
      'fabric conditioner', 'fabric softener', 'fabcon', 'floor wax', 'broom',
      'trash bag', 'garbage bag', 'air freshener', 'candle', 'battery', 'lighter',
      'match', 'matches', 'mop', 'sponge'
    ]
  },
  {
    category: 'Canned Goods',
    keywords: [
      'canned', 'sardines', 'sardine', 'tuna', 'corned beef', 'luncheon meat',
      'meat loaf', 'meatloaf', 'del monte', 'tomato sauce', 'mushroom', 'vienna sausage'
    ]
  },
  {
    category: 'Bakery',
    keywords: [
      'bread', 'loaf', 'pandesal', 'cake', 'pastry', 'bun', 'ensaymada', 'hopia',
      'croissant', 'muffin', 'donut', 'doughnut'
    ]
  },
  {
    category: 'Noodles',
    keywords: [
      'noodle', 'noodles', 'ramen', 'pancit', 'mami', 'pasta', 'spaghetti',
      'macaroni', 'bihon', 'canton', 'instant mami'
    ]
  },
  {
    category: 'Beverages',
    keywords: [
      'water', 'juice', 'soda', 'softdrink', 'soft drink', 'cola', 'coca cola',
      'coke', 'sprite', 'pepsi', 'coffee', 'tea', 'milk tea', 'energy drink',
      'sports drink', 'beverage', 'drink', 'chocolate drink', 'bottled water'
    ]
  },
  {
    category: 'Dairy',
    keywords: [
      'milk', 'cheese', 'butter', 'margarine', 'yogurt', 'yoghurt', 'egg', 'eggs',
      'cream', 'condensed milk', 'evaporated milk'
    ]
  },
  {
    category: 'Snacks',
    keywords: [
      'chips', 'chip', 'crisps', 'biscuit', 'cookie', 'cookies', 'candy', 'candies',
      'chocolate', 'choco', 'wafer', 'cracker', 'crackers', 'nuts', 'popcorn',
      'snack', 'snacks', 'pretzel', 'gum', 'chewing gum'
    ]
  }
];

function cleanName(value) {
  const name = String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  if (!name || name.length > 60) return null;
  return name;
}

function normalize(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function hasKeyword(text, keyword) {
  const haystack = text;
  const needle = normalize(keyword);
  if (!haystack || !needle) return false;
  if (needle.indexOf(' ') >= 0) return (' ' + haystack + ' ').indexOf(' ' + needle + ' ') >= 0;
  return new RegExp('(^| )' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(haystack);
}

function classifyName(name) {
  const text = normalize(name);
  if (!text) return FALLBACK_CATEGORY;
  let best = null;
  let bestLength = 0;
  for (const rule of KEYWORD_RULES) {
    for (const keyword of rule.keywords) {
      if (!hasKeyword(text, keyword)) continue;
      const length = normalize(keyword).length;
      if (length > bestLength) {
        best = rule.category;
        bestLength = length;
      }
    }
  }
  return best || FALLBACK_CATEGORY;
}

module.exports = {
  FALLBACK_CATEGORY,
  DEFAULT_CATEGORIES,
  KEYWORD_RULES,
  cleanName,
  normalize,
  classifyName
};
