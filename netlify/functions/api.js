// API do site (/api/*) rodando como função da Netlify
const serverless = require('serverless-http');
const app = require('../../server');

module.exports.handler = serverless(app);
