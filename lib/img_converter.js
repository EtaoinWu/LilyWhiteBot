const { withFile, withDir } = require('tmp-promise');
const { Readable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const winston = require('winston');
const { execa } = require('execa');

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
        resolve({ data, type: 'image/gif', name: 'converted.gif' })
      })
    })
  }

  async convertTgsToGif(tgs) {
    return null
  }

  convertWebmToGif(img) {
    return new Promise((resolve, reject) => {
        let buffer = img.data
        // convert webm to frames with ffmpeg
        withDir(async (o) => {
          let frames_dir = o.path
          ffmpeg(buffer).output(frames_dir.path + '/%04d.png').on('end', async () => {
            // convert frames to gif with gifski
            let gif = await this.convertFramesToGif(frames_dir.path)
            resolve(gif)
          }).run()
        })
    })
  }

  async convert(stream, ext) {
    if (ext === '.webm') {
      return await this.convertWebmToGif(stream)
    }
    if (ext === '.tgs') {
      return await this.convertTgsToGif(stream)
    }
    return null
  }
};

module.exports = ImgConverter;
