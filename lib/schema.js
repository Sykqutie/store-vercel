'use strict';
// Single source of truth for the schema: database/schema.sql (bundled with the function via vercel.json includeFiles).
const fs = require('fs');
const path = require('path');

module.exports = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
