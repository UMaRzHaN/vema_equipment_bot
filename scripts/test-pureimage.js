const PImage = require('pureimage');
const fs = require('fs');

const img = PImage.make(200, 100);
const ctx = img.getContext('2d');
ctx.fillStyle = '#fff';
ctx.fillRect(0, 0, 200, 100);
ctx.fillStyle = '#000';
ctx.font = '18pt Arial';
ctx.fillText('Привет', 10, 50);
const out = fs.createWriteStream('test-image.png');
PImage.encodePNGToStream(img, out).then(() => console.log('ok')).catch((err) => console.error(err));
