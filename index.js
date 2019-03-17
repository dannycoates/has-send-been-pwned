const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const path = require('path');
const rimraf = require('rimraf');
const fetch = require('node-fetch');
const puppeteer = require('puppeteer');

function sha256(buffer) {
  const h = crypto.createHash('sha256')
  h.update(buffer);
  return h.digest('base64');
}

process.on('unhandledRejection', r => {
  console.error(r.message);
  process.exit(1)
});

(async function main() {
  //
  const cwd = path.resolve(__dirname, 'send')
  console.error('Checking if https://send.firefox.com has been pwned...');
  try {
    // clean up
    rimraf.sync('send')

    // download
    const __version__ = await fetch('https://send.firefox.com/__version__')
    const { version } = await __version__.json();
    console.error(`Downloading ${version} from https://github.com/mozilla/send`)
    await exec(`git clone --depth 1 --single-branch --branch ${version} https://github.com/mozilla/send.git`, { cwd: __dirname })

    // build
    console.error('Installing dependencies...')
    await exec('npm install', { cwd })
    console.error('Building...')
    await exec('npm run build', { cwd })
  }
  catch (e) {
    console.error('There was a problem setting up Send locally. Try to fix this error and try again.');
    console.error(e.message);
    process.exit(1);
  }

  // compare
  console.error('Comparing local js files with send.firefox.com')
  const dist = path.resolve(cwd, 'dist')
  const files = fs.readdirSync(dist)
  for (const file of files) {
    if (/\.js$/.test(file)) {
      const localSHA = sha256(fs.readFileSync(path.resolve(dist, file)));
      const remote = await fetch(`https://send.firefox.com/${file}`);
      const remoteSHA = sha256(await remote.buffer());
      assert.equal(remoteSHA, localSHA, `Send might be pwned. ${file} doesn't match expected hash. ⚠️`);
      console.error(file, 'ok ✅');
    }
  }

  // check html
  console.error('Checking js loaded from html...')
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on('response', async response => {
    const url = response.url();
    if (/\.js$/.test(url)) {
      const file = /.+\/(.+)$/.exec(url)[1];
      const localSHA = sha256(fs.readFileSync(path.resolve(dist, file)))
      const remoteSHA = sha256(await response.buffer());
      assert.equal(remoteSHA, localSHA, `Send might be pwned. ${file} doesn't match expected hash. ⚠️`);
      console.error(url, 'ok ✅')
    }
  })
  await page.goto('https://send.firefox.com');
  const scriptTags = await page.$$eval('script', tags => tags.map(t => t.outerHTML));
  console.error('Please manually inspect these inline script tags. 👇')
  for (const tag of scriptTags) {
    console.error(tag)
  }
  await page.waitFor(() => typeof(window.app) === 'object');
  await page.waitFor(2000);
  await browser.close();
  console.error('')
  console.error('https://send.firefox.com is probably ok. it matches the code on github ❤️')
})();