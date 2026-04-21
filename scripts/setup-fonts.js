'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, '../assets/fonts');
const FONT_PATH = path.join(FONT_DIR, 'DejaVuSans.ttf');

const FONT_URLS = [
  'https://cdn.jsdelivr.net/npm/dejavu-fonts-npm@2.37.3/fonts/ttf/DejaVuSans.ttf',
  'https://raw.githubusercontent.com/dejavu-fonts/dejavu-fonts/master/fonts/DejaVuSans.ttf',
];

if (fs.existsSync(FONT_PATH)) {
  console.log('Font already present, skipping download.');
  process.exit(0);
}

fs.mkdirSync(FONT_DIR, { recursive: true });

function download(urls, index = 0) {
  if (index >= urls.length) {
    console.error('All font download attempts failed. Install fonts manually:\n  sudo apt-get install -y fonts-dejavu-core');
    process.exit(1);
  }

  const url = urls[index];
  console.log(`Downloading font from ${url} ...`);

  const file = fs.createWriteStream(FONT_PATH);

  https.get(url, (res) => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      file.close();
      fs.unlink(FONT_PATH, () => {});
      return download([res.headers.location, ...urls.slice(index + 1)], 0);
    }
    if (res.statusCode !== 200) {
      file.close();
      fs.unlink(FONT_PATH, () => {});
      console.warn(`HTTP ${res.statusCode} — trying next URL`);
      return download(urls, index + 1);
    }
    res.pipe(file);
    file.on('finish', () => {
      file.close();
      console.log(`Font saved to ${FONT_PATH}`);
    });
  }).on('error', (err) => {
    file.close();
    fs.unlink(FONT_PATH, () => {});
    console.warn(`Error: ${err.message} — trying next URL`);
    download(urls, index + 1);
  });
}

download(FONT_URLS);
