const { withFile, withDir } = require('tmp-promise');
const { Readable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs/promises');
const winston = require('winston');
const execa = require('execa');
const NodeCache = require( "node-cache" );
const myCache = new NodeCache();
const hasha = require('hasha');

const promiseToStream = (promise) => {
  const readable = new Readable({
    read() {}
  });
  promise.then((data) => {
    if (data === null) {
      readable.push(null);
      return;
    }
    readable.push(data);
    readable.push(null);
  }).catch((err) => {
    readable.emit('error', err);
  });
  return readable;
}

const streamToPromise = (stream) => {
  return new Promise((resolve, reject) => {
    let bufs = []
    stream.on('data', (d) => {
      bufs.push(d)
    })
    stream.on('end', () => {
      resolve(Buffer.concat(bufs))
    })
    stream.on('error', (e) => {
      reject(e)
    })
  })
}

function waitForKey(keyCode) {
    return new Promise(resolve => {
        process.stdin.on('data',function (chunk) {
            if (chunk[0] === keyCode) {
                resolve();
                process.stdin.pause();
            }
        });
    });
}

class ImgConverter {
  constructor(config = {}) {
    this.config = config
    this.tgs2png_binary = config.tgs2png || './tgs2png'
    this.gifski_binary = config.gifski || 'gifski'
  }

  convertFramesToGif(frames_dir) {
    return new Promise((resolve, reject) => {
      withFile(async (o) => {
        let gif = o.path
        let files = (await fs.readdir(frames_dir)).map(f => frames_dir + '/' + f)
        let args = [
          '--output', gif,
          ...files
        ]
        try {
          let { stdout, stderr } = await execa(this.gifski_binary, args, { timeout: 10000 })
        } catch (e) {
          winston.warn('gifski failed', e)
          resolve(null)
          return
        }
        let data = await fs.readFile(gif)
        resolve(data)
      }, { postfix: '.gif' })
    })
  }

  async convertTgsToGif(tgs) {
    return null
  }

  convertWebmToGif(stream) {
    return new Promise((resolve, reject) => {
      // write stream to a temp file
      withFile(async (o) => {
        let webm = o.path
        let payload = await streamToPromise(stream)
        let digest = hasha(payload)
        let res = myCache.get(digest)
        if (res) {
          resolve(res)
          return
        }
        await fs.writeFile(webm, payload)
        await withDir(async (o) => {
          let frames_dir = o.path
          let args = [
            '-i', webm,
            frames_dir + '/%05d.png'
          ]
          try {
            let { stdout, stderr } = await execa('ffmpeg', args, { timeout: 10000 })
          }
          catch (e) {
            winston.warn('ffmpeg failed', e)
            resolve(null)
            return
          }
          let gif = await this.convertFramesToGif(frames_dir)
          myCache.set(digest, gif)
          resolve(gif)
        }, { unsafeCleanup: true })
      }, { postfix: '.webm' })
    })
  }

  convert(stream, ext) {
    if (ext === '.webm') {
      return promiseToStream(this.convertWebmToGif(stream))
    }
    if (ext === '.tgs') {
      return promiseToStream(this.convertTgsToGif(stream))
    }
    return null
  }
};

module.exports = ImgConverter;
