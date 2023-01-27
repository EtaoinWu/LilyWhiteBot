/*
 * 集中處理檔案：將檔案上傳到圖床，取得 URL 並儲存至 context 中
 *
 * 已知的問題：
 * Telegram 音訊使用 ogg 格式，QQ 則使用 amr 和 silk，這個可以考慮互相轉換一下
 *
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const request = require('request');
const sharp = require('sharp');
const winston = require('winston');
const fileType = require('file-type');
const ImgConverter = require('../../lib/img_converter');

let options = {};
let servemedia;
let handlers;
let imgConverter;

const pkg = require('../../package.json');
const USERAGENT = `LilyWhiteBot/${pkg.version} (${pkg.repository})`;

/**
 * 根据已有文件名生成新文件名
 * @param {string} name 文件名
 * @returns {string} 新文件名
 */
const generateFileName = (url, name) => {
    let extName = path.extname(name || '');
    if (extName === '') {
        extName = path.extname(url || '');
    }
    if (extName === '.webp') {
        extName = '.png';
    }
    return crypto.createHash('md5').update(name || (Math.random()).toString()).digest('hex') + extName;
};

const generateFileNameWithExt = (url, name, ext) => {
    let extName = path.extname(name || '');
    if (extName === '') {
        extName = path.extname(url || '');
    }
    if (extName === '.webp') {
        extName = '.png';
    }
    if (ext) {
        extName = extName + '.' + ext;
    }
    return crypto.createHash('md5').update(name || (Math.random()).toString()).digest('hex') + extName;
};

/**
 * 将各聊天软件的媒体类型转成标准类型
 * @param {string} type 各Handler提供的文件类型
 * @returns {string} 统一文件类型
 */
const convertFileType = (type) => {
    switch (type) {
        case 'sticker':
            return 'image';
        case 'voice':
            return 'audio';
        case 'video':
        case 'document':
            return 'file';
        default:
            return type;
    }
};

const originalFileURI = (file) => {
    if (file.url) {
        return file.url;
    } else if (file.path) {
        if (servemedia.qq_prefix && file.path.startsWith("data/"))
            return 'file://' + servemedia.qq_prefix + file.path;
        return file.path;
    }
    return null;
};

/**
 * 下载/获取文件内容，对文件进行格式转换（如果需要的话），然后管道出去
 * @param {*} file 
 * @param {*} pipe 
 * @returns {Promise}
 */
const getFileStream = (file) => {
    let filePath = file.url || file.path;
    let fileStream;

    if (file.url) {
        fileStream = request.get(file.url);
    } else if (file.path) {
        let path = file.path;
        if (servemedia.qq_prefix && path.startsWith("data/")) {
            path = servemedia.qq_prefix + path;
        }
        fileStream = fs.createReadStream(path);
    } else {
        throw new TypeError('unknown file type');
    }

    // Telegram默认使用webp格式，转成png格式以便让其他聊天软件的用户查看
    if (['sticker', 'image'].includes(file.type) && ['.webm', '.tgs', '.webp'].includes(path.extname(filePath))) {
        let newStream = imgConverter.convert(fileStream, path.extname(filePath));
        fileStream = newStream || fileStream;
    }
    
    // if (file.type === 'record') {
    //   // TODO: 語音使用silk格式，需要wx-voice解碼
    // }

    return fileStream;

};

const pipeFileStream = (file, pipe) => new Promise((resolve, reject) => {
    let fileStream = getFileStream(file);
    fileStream.on('error', e => reject(e))
        .on('end', () => resolve())
        .pipe(pipe);
});

const uploadToBuffer = (file) => new Promise((resolve, reject) => {
    let buf = []

    let pendingFileStream = getFileStream(file);

    pendingFileStream.on('error', (e) => {
        reject(e);
    });

    pendingFileStream.on('data', (chunk) => {
        buf.push(chunk);
    });

    pendingFileStream.on('end', async () => {
        let buffer = Buffer.concat(buf);
        let type = (await fileType.fromBuffer(buffer)) || {};
        let name = generateFileNameWithExt(file.url || file.path, file.id, type.ext);
        // servemedia.cache[name] = buffer;
        resolve({'name': name, 'type': type.mime, 'data': buffer});
    });
});

/*
 * 儲存至本機快取
 */
const uploadToCache = async (file) => {
    let targetName = generateFileName(file.url || file.path, file.id);
    let targetPath = path.join(servemedia.cachePath, targetName);
    let writeStream = fs.createWriteStream(targetPath).on('error', (e) => { throw e; });
    await pipeFileStream(file, writeStream);
    return servemedia.serveUrl + targetName;
};

/*
 * 上传到各种图床
 */
const uploadToHost = (host, file) => new Promise((resolve, reject) => {
    const requestOptions = {
        timeout: servemedia.timeout || 3000,
        headers: {
            'User-Agent': servemedia.userAgent || USERAGENT,
        },
    };

    let name = generateFileName(file.url || file.path, file.id);
    let pendingFileStream = getFileStream(file);
	
	// p4: reject .exe (complaint from the site admin)
	if (path.extname(name) === '.exe') {
		reject('We wont upload .exe file');
        return;
	}

    let buf = []
    pendingFileStream
        .on('data', d => buf.push(d))
        .on('end', async () => {
            let pendingFile = Buffer.concat(buf);
            if (!path.extname(name)) {
              let type = await fileType.fromBuffer(pendingFile);
              if (type) name += '.' + type.ext;
            }

            switch (host) {
                case 'vim-cn':
                case 'vimcn':
                    requestOptions.url = 'https://img.vim-cn.com/';
                    requestOptions.formData = {
                        name: {
                            value: pendingFile,
                            options: {
                                filename: name,
                            },
                        },
                    };
                    break;

                case 'sm.ms':
                    requestOptions.url = 'https://sm.ms/api/upload';
                    requestOptions.json = true;
                    requestOptions.formData = {
                        smfile: {
                            value: pendingFile,
                            options: {
                                filename: name,
                            },
                        },
                    };
                    break;

                case 'imgur':
                    if (servemedia.imgur.apiUrl.endsWith('/')) {
                        requestOptions.url = servemedia.imgur.apiUrl + 'upload';
                    } else {
                        requestOptions.url = servemedia.imgur.apiUrl + '/upload';
                    }
                    requestOptions.headers.Authorization = `Client-ID ${servemedia.imgur.clientId}`;
                    requestOptions.json = true;
                    requestOptions.formData = {
                        type: 'file',
                        image: {
                            value: pendingFile,
                            options: {
                                filename: name,
                            },
                        },
                    };
                    break;

                case 'uguu':
                case 'Uguu':
                    requestOptions.url = servemedia.uguuApiUrl || servemedia.UguuApiUrl; // 原配置文件以大写字母开头
                    requestOptions.formData = {
                        'files[]': {
                            value: pendingFile,
                            options: {
                                filename: name,
                            }
                        },
                        randomname: 'true'
                    };
                    break;
                    
                case 'lsky':
                    requestOptions.url = servemedia.lsky.apiUrl;
                    if (servemedia.lsky.token) {
                        requestOptions.headers.token = servemedia.lsky.token;
                    }
                    requestOptions.formData = {
                        image: {
                            value: pendingFile,
                            options: {
                                filename: name,
                            }
                        },
                    };
                    break;
                    

                case 'chevereto':
                    requestOptions.url = servemedia.chevereto.apiUrl;
                    requestOptions.formData = {
                        source: {
                            value: pendingFile,
                            options: {
                                filename: name,
                            }
                        },
                        key: servemedia.chevereto.key,
                        expiration: servemedia.chevereto.expiration,
                        format: 'json'
                    };
                    break;

                default:
                    reject(new Error('Unknown host type'));
            }

            request.post(requestOptions, (error, response, body) => {
                winston.debug(`Upload to ${host} return: ${JSON.stringify(body)}`);
                if (typeof callback === 'function') {
                    callback();
                }
                if (!error && response.statusCode === 200) {
                    if (typeof body === 'string') body = JSON.parse(body);
                    switch (host) {
                        case 'vim-cn':
                        case 'vimcn':
                            resolve(body.trim().replace('http://', 'https://'));
                            break;
                        case 'uguu':
                        case 'Uguu':
                            resolve(body.trim());
                            break;
                        case 'sm.ms':
                            if (body && body.code !== 'success') {
                                reject(new Error(`sm.ms return: ${body.msg}`));
                            } else {
                                resolve(body.data.url);
                            }
                            break;
                        case 'imgur':
                            if (body && !body.success) {
                                reject(new Error(`Imgur return: ${body.data.error}`));
                            } else {
                                winston.debug(`Imgur return: ${JSON.stringify(body)}`);
                                resolve(body.data.link);
                            }
                            break;
                        case 'chevereto':
                            if (body && body.status_code !== 200) {
                                reject(new Error(`Chevereto return: ${body.message}`));
                            } else {
                                resolve(body.image.url);
                            }
                            break;
                        case 'lsky':
                            if (body && body.code !== 200) {
                                reject(new Error(`Lsky return: ${body.msg}`));
                            } else {
                                resolve(body.data.url);
                            }
                            break;
                    }
                } else {
                    reject(new Error(error));
                }
            });
        });
});

/*
 * 上傳到自行架設的 linx 圖床上面
 */
const uploadToLinx = (file) => new Promise((resolve, reject) => {
    let name = generateFileName(file.url || file.path, file.id);

    pipeFileStream(file, request.put({
        url: servemedia.linxApiUrl + name,
        headers: {
            'User-Agent': servemedia.userAgent || USERAGENT,
            'Linx-Randomize': 'yes',
            'Accept': 'application/json'
        }
    }, (error, response, body) => {
        if (!error && response.statusCode === 200) {
            resolve(JSON.parse(body).direct_url);
        } else {
            reject(new Error(error));
        }
    })).catch(err => reject(err));
});

/*
 * 決定檔案去向
 */
const uploadFile = async (file) => {
    let url;
    let fileType = convertFileType(file.type);
    let result = {};

    switch (servemedia.type) {
        case 'vimcn':
        case 'vim-cn':
        case 'uguu':
        case 'Uguu':
        case 'lsky':
        case 'chevereto':
            url = await uploadToHost(servemedia.type, file);
            break;

        case 'sm.ms':
        case 'imgur':
            // 公共图床只接受图片，不要上传其他类型文件
            if (fileType === 'image') {
                url = await uploadToHost(servemedia.type, file);
            }
            break;

        case 'self':
            url = await uploadToCache(file)
            break;

        case 'linx':
            url = await uploadToLinx(file)
            break;

        case 'source':
            // 直接使用原網址
            url = file.url;
            break;

        case 'buffer':
            // Buffer only
            url = 'qaq';
            break;

        default:

    }

    if (url) {
        // return {
        //     type: fileType,
        //     url: url,
        //     original_uri: originalFileURI(file)
        // };
        result.type = fileType;
        result.url = url;
        result.original_uri = originalFileURI(file);
    }
    result.buffer = await uploadToBuffer(file);
    return result;
};

/*
 * 判斷訊息來源，將訊息中的每個檔案交給對應函式處理
 */
const fileUploader = {
    init: (opt) => {
        options = opt;
        servemedia = options.options.servemedia || {};
        servemedia.cache = servemedia.cache || {};
        imgConverter = new ImgConverter(options.options.imgConverter || {});
    },
    get handlers() { return handlers; },
    set handlers(h) { handlers = h; },
    process: async (context) => {
        // 上传文件
		// p4: dont bother with files from somewhere without bridges in config
		if (context.extra.clients > 1 && context.extra.files && servemedia.type && servemedia.type !== 'none') {
            let promises = [];
            let fileCount = context.extra.files.length;

            // 将聊天消息附带文件上传到服务器
            for (let [index, file] of context.extra.files.entries()) {
                if (servemedia.sizeLimit && servemedia.sizeLimit > 0 && file.size && file.size > servemedia.sizeLimit*1024) {
                    winston.debug(`[file.js] <FileUploader> #${context.msgId} File ${index+1}/${fileCount}: Size limit exceeded. Ignore.`);
                } else {
                    winston.debug(`[file.js] <FileUploader> #${context.msgId} File ${index+1}/${fileCount}: Uploading...`);
                    promises.push(uploadFile(file));
                }
            }

            // 整理上传到服务器之后到URL
            let uploads = (await Promise.all(promises)).filter(x => x);
            for (let [index, upload] of uploads.entries()) {
                winston.debug(`[file.js] <FileUploader> #${context.msgId} File ${index+1}/${uploads.length} (${upload.type}): ${upload.url}`);
            }

            return uploads;
        } else {
            return [];
        }
    },
};

module.exports = (bridge, options) => {
    fileUploader.init(options);
    fileUploader.handlers = bridge.handlers;

    bridge.addHook('bridge.send', async (msg) => {
        try {
            msg.extra.uploads = await fileUploader.process(msg);
        } catch (e) {
            winston.error(`Error on processing files: `, e);
            msg.callbacks.push(new bridge.BridgeMsg(msg, {
                text: 'File upload error',
                isNotice: true,
                extra: {},
            }));
        }
    });
};
