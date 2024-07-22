const stringify = require('string.ify');

async function pastebin(obj) {
  let str = "";
  if (typeof obj === 'string') str = obj;
  else str = stringify(obj);
  let resp = await fetch('https://paste.c-net.org/', { method: 'POST', body: str })
  return resp.text()
}
module.exports = {
  pastebin
}
