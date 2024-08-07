const util = require('util');
const { withFile, withDir } = require('tmp-promise');
const { Readable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffprobe = util.promisify(ffmpeg.ffprobe);
const fs = require('fs/promises');
const winston = require('winston');
const execa = require('execa');
const LRUCache = require('lru-cache')
const hasha = require('hasha');

const myCache = new LRUCache({
  max: 500,
  ttl: 1000 * 60 * 60 * 24 * 7, // 1 week
  maxSize: 100 * 1024 * 1024, // 100 MB
  sizeCalculation: (value, key) => {
    return value.length + 64
  },
});

function promisifyCommand(command, run = 'run') {
  return util.promisify((...args) => {
    const cb = args.pop()
    command
      .on('end', () => { cb(null) })
      .on('error', (error) => { cb(error) })[run](...args)
  })
}

const promiseToStream = (promise) => {
  const readable = new Readable({
    read() { }
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
    process.stdin.on('data', function (chunk) {
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
    this.tgs2png_binary = config.tgs2png || 'tgs2png'
    this.gifski_binary = config.gifski || 'gifski'
    this.ffmpeg_binary = config.ffmpeg || 'ffmpeg'
    this.magick_binary = config.magick || 'convert'
    this.dwebp_binary = config.dwebp || 'dwebp'
    this.tgs_fps = config.tgs_fps || 10
  }

  convertFramesToGif(frames_dir, fps) {
    return new Promise((resolve, reject) => {
      withFile(async (o) => {
        let gif = o.path
        let files = (await fs.readdir(frames_dir)).filter(f => f.endsWith("png")).map(f => frames_dir + '/' + f)
        let args = [
          '--output', gif,
          '--fps', fps,
          ...files
        ]
        try {
          winston.debug('[img_converter.js] <Gif> gifski ' + args.join(' '))
          let { stdout, stderr } = await execa(this.gifski_binary, args, { timeout: 30000 })
          let data = await fs.readFile(gif)
          resolve(data)
        } catch (e) {
          winston.warn('[img_converter.js] <Gif> gifski failed', e)
          reject(e)
        }
      }, { postfix: '.gif' })
    })
  }

  convertTgsToGif(stream) {
    return new Promise((resolve, reject) => {
      withFile(async (o) => {
        let tgs = o.path
        let payload = await streamToPromise(stream)
        let digest = hasha(payload)
        let res = myCache.get(digest)
        if (res) {
          winston.info('[img_converter.js] <TGS> cache hit')
          resolve(res)
          return
        }
        winston.info('[img_converter.js] <TGS> cache miss')
        await fs.writeFile(tgs, payload)
        winston.debug(`[img_converter.js] <TGS> written ${payload.length} bytes to ${o.path}`)
        await withDir(async (o) => {
          let frames_dir = o.path
          try {
            let args = [
              '--output', frames_dir,
              '--fps', this.tgs_fps,
              '--threads', 1,
              tgs
            ]
            winston.debug('[img_converter.js] <TGS> tgs2png ' + args.join(' '))
            let { stdout, stderr } = await execa(this.tgs2png_binary, args, { timeout: 30000 })
            frames_dir = frames_dir + '/' + (await fs.readdir(frames_dir))[0]
            let fps = this.tgs_fps
            let gif = await this.convertFramesToGif(frames_dir, fps)
            myCache.set(digest, gif)
            winston.debug(`[img_converter.js] <TGS> output length ${gif.length} bytes, hash ${hasha(gif)}`)
            resolve(gif)
          }
          catch (e) {
            winston.warn('[img_converter.js] <TGS> tgs2png failed', e)
            reject(e)
          }
        }, { unsafeCleanup: true })
      }, { postfix: '.tgs' })
    })
  }

  convertWebmToGif(stream) {
    return new Promise((resolve, reject) => {
      withFile(async (o) => {
        let webm = o.path
        let payload = await streamToPromise(stream)
        let digest = hasha(payload)
        let res = myCache.get(digest)
        if (res) {
          winston.info('[img_converter.js] <Webm> cache hit')
          resolve(res)
          return
        }
        winston.info('[img_converter.js] <Webm> cache miss')
        await fs.writeFile(webm, payload)
        await withDir(async (o) => {
          let frames_dir = o.path
          try {
            let args = [
              '-c:v', 'libvpx-vp9',
              '-i', webm,
              '-y',
              frames_dir + '/%05d.png'
            ]
            winston.debug('[img_converter.js] <Webm> ffmpeg ' + args.join(' '))
            let { stdout, stderr } = await execa(this.ffmpeg_binary, args, { timeout: 30000 })
            let probe = await ffprobe(webm)
            let fps = probe.streams[0].r_frame_rate.split('/').map(x => parseInt(x)).reduce((a, b) => a / b)
            let gif = await this.convertFramesToGif(frames_dir, fps)
            myCache.set(digest, gif)
            winston.debug(`[img_converter.js] <Webm> output length ${gif.length} bytes, hash ${hasha(gif)}`)
            resolve(gif)
          }
          catch (e) {
            winston.warn('[img_converter.js] <Webm> ffmpeg failed', e)
            reject(e)
          }
        }, { unsafeCleanup: true })
      }, { postfix: '.webm' })
    })
  }

  convertWebpToPng(stream) {
    return new Promise((resolve, reject) => {
      withFile(async (o) => {
        let webp = o.path
        let payload = await streamToPromise(stream)
        let digest = hasha(payload)
        let res = myCache.get(digest)
        if (res) {
          winston.info('[img_converter.js] <Webp> cache hit')
          resolve(res)
          return
        }
        winston.info('[img_converter.js] <Webp> cache miss')
        await fs.writeFile(webp, payload)
        await withFile(async (o) => {
          let png = o.path
          try {
            let args = [
              webp,
              "(",
              "-clone", "0", "-alpha", "opaque", "+level-colors", "white",
              "-alpha", "transparent",
              ")",
              "-compose", "dstover", "-composite",
              png
            ]
            winston.debug('[img_converter.js] <Webp> magick ' + args.join(' '))
            let { stdout, stderr } = await execa(this.magick_binary, args, { timeout: 30000 })
            let data = await fs.readFile(png)
            myCache.set(digest, data)
            winston.debug(`[img_converter.js] <Webp> output length ${data.length} bytes, hash ${hasha(data)}`)
            resolve(data)
          }
          catch (e) {
            winston.warn('[img_converter.js] <Webp> magick failed', e)
            reject(e)
          }
        }, { postfix: '.png' })
      }, { postfix: '.webp' })
    })
  }

  convert(stream, ext) {
    if (ext === '.webm') {
      return promiseToStream(this.convertWebmToGif(stream))
    }
    if (ext === '.tgs') {
      return promiseToStream(this.convertTgsToGif(stream))
    }
    if (ext === '.webp') {
      return promiseToStream(this.convertWebpToPng(stream))
    }
    return null
  }
};

module.exports = ImgConverter;
