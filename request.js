require('dotenv').config();
const rp = require('request-promise');

const PROXY = process.env.WEBSHARE_PROXY_URL;
if (!PROXY) {
  console.error('ERROR: Set WEBSHARE_PROXY_URL in environment or in .env (do not commit .env)');
  process.exit(1);
}

rp({
  url: 'http://ipv4.webshare.io/',
  proxy: PROXY,
  timeout: 15000
})
.then(function (data) {
  console.log(data);
})
.catch(function (err) {
  console.error('Request failed:', err && err.message ? err.message : err);
});
