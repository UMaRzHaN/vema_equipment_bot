'use strict';

const https = require('https');
const logger = require('../utils/logger');

function parseNominatimAddress(address) {
  if (!address || typeof address !== 'object') return null;
  return address.city || address.town || address.village || address.hamlet || address.county || address.state || null;
}

async function getCityByCoordinates(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&accept-language=ru`;
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'vema-equipment-bot/1.0' } }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const city = parseNominatimAddress(data.address);
          resolve(city || null);
        } catch (err) {
          logger.warn({ err: err.message, url }, 'Failed to parse reverse geocode response');
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      logger.warn({ err: err.message, url }, 'Reverse geocode request failed');
      resolve(null);
    });
    req.end();
  });
}

module.exports = { getCityByCoordinates };
