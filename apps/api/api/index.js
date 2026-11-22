// Vercel serverless function: every request to the API project is routed here (see
// vercel.json) and handed to the Nest application. The application itself is in
// src/serverless.ts; this file only exists because Vercel discovers functions by their
// place in the `api/` directory.
module.exports = require('../dist/serverless.js').default;
