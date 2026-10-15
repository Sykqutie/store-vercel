'use strict';
// Local development server: same pages and API as the Vercel deployment.
//   cp .env.example .env   (fill in DATABASE_URL and AUTH_SECRET)
//   npm install && npm run dev
const express = require('express');
const path = require('path');
const app = require('./api/index.js');

const PAGES = {
  '/': 'index', '/login': 'login', '/install': 'install', '/dashboard': 'dashboard', '/pos': 'pos',
  '/products': 'products', '/inventory': 'products', '/edit-product': 'edit-product', '/report': 'report', '/receipt': 'receipt'
};

const root = express();
root.use(app); // handles /api/*; other paths fall through
root.use(express.static(path.join(__dirname, 'public')));
root.get(Object.keys(PAGES), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'html', PAGES[req.path] + '.html'));
});

const port = process.env.PORT || 3000;
if (require.main === module) {
  root.listen(port, () => console.log(`Store running at http://localhost:${port}`));
}
module.exports = root;
