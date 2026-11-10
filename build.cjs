const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, name) => '<style>\n' + fs.readFileSync(path.join(root, name), 'utf8') + '\n</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, name) => '<script>\n' + fs.readFileSync(path.join(root, name), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n</script>');
const licenses = Object.fromEntries(['JSZIP', 'SAX', 'LUCIDE'].map(name => [name, fs.readFileSync(path.join(root, 'vendor', name + '-LICENSE.txt'), 'utf8')]));
html = html.replace('</head>', '<script type="application/json" id="third-party-licenses">' + JSON.stringify(licenses).replace(/<\/script/gi, '<\\/script') + '</script>\n</head>');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
let shipping = read('src/shipping/index.template.html');
const shippingAssets = {
  APP_CSS: ['app.css', 'tables.css', 'packing.css', 'embed.css'].map(name => read('src/shipping/' + name)).join('\n'),
  XLSX_LIBRARY: read('vendor/shipping/xlsx.full.min.js'),
  PACKING_LIBRARY: read('vendor/shipping/xlsx-populate.min.js'),
  CORE_JS: read('src/shipping/core.js'),
  APP_JS: read('src/shipping/app.js'),
  PACKING_JS: read('src/shipping/packing.js')
};
for (const [marker, source] of Object.entries(shippingAssets)) {
  shipping = shipping.replace('/* ' + marker + ' */', () => source.replace(/<\/script/gi, '<\\/script').replace(/^\/\/# sourceMappingURL=.*$/gm, ''));
}
const shippingLicenses = ['LICENSE', 'XLSX-POPULATE-LICENSE'].map(name => read('vendor/shipping/' + name));
shipping = shipping.replace('</head>', () => '<script type="application/json" id="shipping-licenses">' + JSON.stringify(shippingLicenses).replace(/</g, '\\u003c') + '</script></head>');
html = html.replace('<!-- SHIPPING_BUNDLE -->', () => '<script id="shipping-bundle" type="application/octet-stream">' + gzipSync(shipping).toString('base64') + '</script>');
fs.writeFileSync(path.join(root, 'Revenue_SKU匹配工具.html'), html);
fs.mkdirSync(path.join(root, 'docs'), {recursive: true});
fs.writeFileSync(path.join(root, 'docs', 'index.html'), html);
fs.writeFileSync(path.join(root, 'docs', '.nojekyll'), '');
console.log('Built Revenue_SKU匹配工具.html (' + Math.round(Buffer.byteLength(html) / 1024) + 'KB)');
