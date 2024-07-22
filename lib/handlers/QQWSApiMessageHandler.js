/*
 * @name 使用通用介面處理 QQ 訊息
 *
 * 備註：不接收討論組訊息
 *
 * 口令紅包沒有任何跡象，所以只好認為：如果一分鐘之內一句話被重複了三次或以上，說明大家在搶紅包
 */

const MessageHandler = require('./MessageHandler.js');
const Context = require('./Context.js');
const { CQWebSocket, CQ } = require("go-cqwebsocket");
const LRU = require("lru-cache");
const { parseMessage: parseCoolQMessage, escape: escapeCoolQStr } = require('../coolq.js');
const { loadConfig } = require('../util.js');
const request = require('request');
const winston = require('winston');
const { get_name } = require('../db.js');
const util = require('util')

function delay(t, val) {
    return new Promise(resolve => setTimeout(resolve, t, val));
}

const id_cvt = (s) => {
    if (s === undefined) return s;
    if (/^\d+$/.test(s)) return 'q(' + s + ')';
    else return 'q<' + s + '>';
}
const my_get_name = (s) => get_name(id_cvt(s));

class QQWSApiMessageHandler extends MessageHandler {
    constructor(config = {}) {
        super();

        let botConfig = config.bot || {};
        let qqOptions = config.options || {};

        // 配置文件兼容性
        for (let key of ['qq', 'wsBaseURL', 'accessToken']) {
            botConfig[key] = botConfig[key] || config[key];
        }

        let wsBaseURL = botConfig.wsBaseURL || 'http://127.0.0.1:8101/';

        winston.debug(`baseURL: ${wsBaseURL}`)

        let client = new CQWebSocket({
            baseUrl: wsBaseURL,
            accessToken: botConfig.accessToken || '',
            clientConfig: {
                headers: {
                    authorization: `Bearer ${botConfig.accessToken || ''}`
                }
            }
        });

        client.connect();
        
        this._clinet_ready = (
            (async () => {
                while(true) {
                    await delay(500);
                    if (client.qq > 0) {
                        return;
                    }
                }
            })()
        );
        
        setTimeout(async () => {
            await this._clinet_ready;
            winston.debug(`Client QQ: ${client.qq}`)
            client.get_version_info().then((json) => {
                winston.info(`QQBot (WS API) Get CoolQ Information: ${json.app_name}, ver ${json.app_version}`);
            })
        }, 0)

        // 載入敏感詞清單
        let badwords = [];
        if (qqOptions.selfCensorship) {
            try {
                badwords = loadConfig('badwords') || [];
            } catch (ex) {
                winston.error('<QQBot> Unable to load badwords list');
            }
        }

        this._type = 'QQ';
        this._id = 'Q';

        this._client = client;
        this._wsBaseURL = wsBaseURL;
        this._accessToken = botConfig.accessToken || '';
        this._selfCensorship = qqOptions.selfCensorship || false;
        this._badwords = badwords;
        this._ignoreCash = qqOptions.ignoreCash || false;
        this._qq = parseInt(botConfig.qq) || 0;
        this._nickStyle = qqOptions.nickStyle || 'groupcard';
        this._showTitle = qqOptions.showTitle || false;
        this._keepSilence = qqOptions.keepSilence || [];

        this._stat = new LRU({
            max: 500,
            maxAge: 60000,
        });

        this._msg_dedupe = new LRU({
            max: 1000,
            maxAge: 60000
        })

        if (this._selfCensorship) {
            this._badwordsRegexp = [];
            for (let word of this._badwords) {
                this._badwordsRegexp.push(new RegExp(word, 'gmu'));
            }
        }

        client.on('message', async (event) => {
            let rawdata = event.context
            const msg_id = rawdata.message_id

            if (this._msg_dedupe.has(msg_id)) {
                return;
            }
            this._msg_dedupe.set(msg_id, true)

            if (!this._enabled) {
                return;
            }

            let isPrivate = rawdata.message_type === 'private';
            let isGpNotice = rawdata.message_type === 'group' && rawdata.sub_type === 'notice'
            const parsedMsg = parseCoolQMessage(rawdata.message);

            let context = new Context({
                from: rawdata.user_id,
                avatar: `https://q.qlogo.cn/headimg_dl?bs=qq&dst_uin=${rawdata.user_id}&spec=140`,
                nick: await my_get_name(rawdata.user_id) || this.getNick(rawdata),
                text: parsedMsg.text,
                isPrivate: isPrivate,
                isGpNotice: isGpNotice,
                extra: { unified_id: id_cvt(rawdata.user_id) },
                handler: this,
                _rawdata: rawdata,
            });

            if (rawdata.anonymous) {
                context.nick = `<匿名消息> ${rawdata.anonymous.name}`;
            }

            if (this._showTitle&&this.getTitle(rawdata)) {
                context.nick = `<${this.getTitle(rawdata)}> ${context.nick}`;
            }

            // 記錄圖片和語音
            let files = [];
            for (let image of parsedMsg.extra.images) {
                let fileItem = {
                    client: 'QQ',
                    type: 'image',
                    id: image,
                };
                // onebot在消息上報使用array格式時會有url值，不用去cqimg文件獲取
                if (image.startsWith('http:') || image.startsWith('https:')) {
                    fileItem.url = image;
                } else {
                    fileItem.path = await this.image(image);
                }
                files.push(fileItem);
            }
            for (let voice of parsedMsg.extra.records) {
                let fileItem = {
                    client: 'QQ',
                    type: 'audio',
                    id: voice,
                };
                // onebot在消息上報使用array格式時會有url值，不用去下載語音文件
                if (voice.startsWith('http:') || voice.startsWith('https:')) {
                    fileItem.url = voice;
                } else {
                    fileItem.path = await this.voice(voice);
                }
                files.push(fileItem);
            }
            context.extra.files = files;

            if (files.length === 0 && this._ignoreCash && !isPrivate) {
                // 過濾紅包訊息（特別是口令紅包），並且防止誤傷（例如「[圖片]」）
                // 若cqhttpapi消息上報使用array格式，則rawdata.message會變成[object Object]，會誤傷
                let msg = `${rawdata.group_id}: ${parsedMsg.text}`;

                let count = this._stat.get(msg) || 0;

                if (++count > 3) {
                    context.extra.isCash = true;
                }

                this._stat.set(msg, count);
            }

            // 記錄 at
            context.extra.ats = parsedMsg.extra.ats;

            if (parsedMsg.extra.reply) {
                let id = parsedMsg.extra.reply;
                context.extra.reply = await this.expandReply(id);
            }

            // 合并转发
            if (parsedMsg.extra.forward && parsedMsg.extra.forward.length > 0) {
                // let id = parsedMsg.extra.forward;
                // let messages = await this._client.send('get_forward_msg', {id: id})
                // winston.debug(`Response: ${util.inspect(messages)}`)
                context.text += '[合并转发，暂不支持]'
            }

            if (isPrivate) {
                context.to = this._qq;
            } else {
                context.to = rawdata.group_id;
            }

            // 檢查是不是命令
            for (let [cmd, callback] of this._commands) {
                if (parsedMsg.text.trim().startsWith(cmd)) {
                    let param = parsedMsg.text.trim().substring(cmd.length);
                    if (param === '' || param.startsWith(' ')) {
                        param = param.trim();

                        context.command = cmd;
                        context.param = param;

                        if (typeof callback === 'function') {
                            callback(context, cmd, param);
                        }

                        this.emit('command', context, cmd, param);
                        this.emit(`command#${cmd}`, context, param);
                    }
                }
            }

            this.emit('text', context);
        });

        client.on('notice', async (event) => {
            let context = event.context
            switch (context.notice_type) {
                case 'group_admin':
                    // 设置/取消群管理员
                    this.emit('admin', {
                        group: parseInt(context.group_id),
                        type: context.sub_type === 'unset' ? 1 : 2, // 1: 取消管理員，2: 設置管理員
                        target: parseInt(context.user_id),
                        time: parseInt(context.time),
                        user: await this.groupMemberInfo(context.group_id, context.user_id),
                    });
                    break;

                case 'group_increase':
                    // 进群
                    this.emit('join', {
                        group: parseInt(context.group_id),
                        admin: parseInt(context.operator_id),
                        target: parseInt(context.user_id),
                        type: context.sub_type === 'approve' ? 1 : 2, // 1: 管理員同意，2: 管理員邀請
                        time: parseInt(context.time),
                        user_target: await this.groupMemberInfo(context.group_id, context.user_id),
                    });
                    break;

                case 'group_decrease':
                    // 退群或被踢
                    this.emit('leave', {
                        group: parseInt(context.group_id),
                        admin: parseInt(context.operator_id), // 管理員 QQ，自行離開時為 0
                        target: parseInt(context.user_id),
                        type: context.sub_type === 'leave' ? 1 : 2, // 1: 自行離開，2: 他人被踢，3: 自己被踢
                        time: parseInt(context.time),
                        user_admin: await this.groupMemberInfo(context.group_id, context.operator_id),
                        user_target: {name: "QQ user"},
                    });
                    break;

                case 'group_ban':
                    // 禁言或解禁
                    let duration = ''
                    if (context.duration) {
                      let tmp = parseInt(context.duration);
                      let s = tmp%60; tmp-=s; tmp/=60;
                      if (s) { duration = ` ${s}秒`; }
                      let m = tmp%60; tmp-=m; tmp/=60;
                      if (m) { duration = ` ${m}分` + duration; }
                      let h = tmp%24; tmp-=h; tmp/=24;
                      if (h) { duration = ` ${h}时` + duration; }
                      if (tmp) { duration = ` ${tmp}天` + duration; }
                    }
                    this.emit('ban', {
                        group: parseInt(context.group_id),
                        type: context.sub_type === 'ban' ? 1 : 2, // 1: 禁言，2: 解除禁言
                        admin: parseInt(context.operator_id), // 管理員 QQ
                        target: parseInt(context.user_id),
                        time: parseInt(context.time),
                        duration: parseInt(context.duration), // 禁言时长，单位秒
                        durstr: duration, // 正常格式禁言时长
                        user_admin: await this.groupMemberInfo(context.group_id, context.operator_id),
                        user_target: await this.groupMemberInfo(context.group_id, context.user_id),
                    });
                    break;
            }
        });
    }

    get qq() { return this._qq; }
    get selfCensorship() { return this._selfCensorship; }
    set selfCensorship(v) { this._selfCensorship = v && true; }
    get ignoreCash() { return this._ignoreCash; }
    set ignoreCash(v) { this._ignoreCash = v && true; }
    get nickStyle() { return this._nickStyle; }
    set nickStyle(v) { this._nickStyle = v; }

    async expandReply(id) {
        let reply_msg = await this._client.send('get_msg', {
            message_id: parseInt(id),
            });
        winston.debug(`Original reply: ${util.inspect(reply_msg)}`)
        let parsed_reply = parseCoolQMessage(reply_msg.message);
        winston.debug(`Parsed reply: ${util.inspect(parsed_reply)}`)
        return {
            id: id,
            unified_to_id: id_cvt(reply_msg.sender.user_id),
            nick: await my_get_name(reply_msg.sender.user_id) || reply_msg.sender.nickname,
            qq: reply_msg.sender.user_id,
            message: parsed_reply.text,
            isText: parsed_reply.text.length > 0,
        }
    }

    getNick(user) {
        if (user) {
            let { user_id, nickname, card,    qq, name, groupCard, } = user.sender;
            user_id = user_id || qq || '';

            if (this._nickStyle === 'groupcard') {
                return card || groupCard || nickname || name || user_id.toString();
            } else if (this._nickStyle === 'nick') {
                return nickname || name || user_id.toString();
            } else {
                return user_id.toString();
            }
        } else {
            return '';
        }
    }

    getTitle(user) {
        if (user) {
            let { title,  honor } = user.sender;
            return !title && !honor ? '' : (title||honor);
        } else return '';
    }

    escape(message) {
        return escapeCoolQStr(message);
    }

    async say(target, message, options = {}) {
        if (!this._enabled) {
            throw new Error('Handler not enabled');
        } else if (this._keepSilence.indexOf(parseInt(target)) !== -1) {
            // 忽略
        } else {
            // 屏蔽敏感詞語
            if (this._selfCensorship) {
                for (let re of this._badwordsRegexp) {
                    message = message.replace(re, (m) => '*'.repeat(m.length));
                }
            }

            if (target.toString().startsWith('@')) {
                // auto_esacpe 为 true 时，插件会自动转义
                // 如果不想自动转义（noEscape = true），那么 auto_escape 需要为 false。
                let realTarget = target.toString().substr(1);
                return await this._client.send('send_private_msg', {
                    user_id: parseInt(realTarget),
                    message: CQ.parse(message),
                    auto_escape: !options.noEscape,
                });
            } else {
                if (options.isPrivate) {
                    return await this._client.send('send_private_msg', {
                        user_id: parseInt(target),
                        message: CQ.parse(message),
                        auto_escape: !options.noEscape,
                    });
                } else {
                    winston.debug(util.inspect({
                        group_id: parseInt(target),
                        message: CQ.parse(message),
                        auto_escape: !options.noEscape,
                    }))
                    return await this._client.send('send_group_msg', {
                        group_id: parseInt(target),
                        message: CQ.parse(message),
                        auto_escape: !options.noEscape,
                    });
                }
            }
        }
    }

    async stringifyNodeMessage(msg) {
        if (msg.type !== 'node') {
            winston.error(`wrong message type ${msg.type} on stringifyNodeMessage()`)
            return ''
        }
        let user_id = msg.data.user_id
        let name = (await my_get_name(user_id)) || msg.data.nickname
        let message = ''
        for (let node of msg.content) {
            switch(node.type) {
                case 'text':
                    message += node.data.text;
                    break;
                case 'face':
                    message += '[表情]';
                    break;
                case 'image':
                    message += '[图片]';
                    break;
                case 'record':
                    message += '[语音]';
                    break;
                case 'at':
                    message += '@' + node.data.qq + ' ';
                    break;
                case 'reply':
                    let id = node.data.id;
                    let reply = await this.expandReply(id);
                    message += reply.text;
            }
        }
        return message;
    }

    async reply(context, message, options = {}) {
        if (context.isPrivate) {
            options.isPrivate = true;
            return await this.say(context.from, message, options);
        } else {
            if (options.noPrefix) {
                return await this.say(context.to, `${message}`, options);
            } else {
                return await this.say(context.to, `${context.nick}: ${message}`, options);
            }
        }
    }

    async groupMemberInfo(group, qq) {
        const info = await this._client.send('get_group_member_info', {
            group_id: parseInt(group),
            user_id: parseInt(qq),
            no_cache: true,
        });
        return {
            group: info.group_id,
            qq: info.user_id,
            name: info.nickname,
            groupCard: info.card,
            rawGroupCard: info.card,
            gender: info.sex === 'unknown' ? '' : info.sex,     // HTTP API 为 male、female 和 unknown，而 cqsocketapi 的未知性别为空串
            age: info.age,
            area: info.area,
            joinTime: info.join_time,
            lastSpeakTime: info.last_sent_time,
            level: info.level,
            userright: info.role === 'owner' ? 'creator' : info.role,   // cqsocketapi 为 creator/admin/member，而 http api 为 owner/admin/member
            hasBadRecord: info.unfriendly,
            honor: info.title,
            honorExpirationTime: info.title_expire_time,
            isGroupCardEditable: info.card_changeable,
        };
    }

    async strangerInfo(qq) {
        const info = await this._client.send('get_stranger_info', {
            user_id: parseInt(qq),
            no_cache: true,
        });
        return {
            qq: info.user_id,
            name: info.nickname,
            gender: info.sex === 'unknown' ? '' : info.sex,
            age: info.age,
        };
    }

    parseMessage(message) {
        return parseCoolQMessage(message);
    }

    _fetchFile(path, type) {
        return new Promise((resolve, reject) => {
            let apiRoot = this._apiRoot;
            if (!apiRoot.endsWith('/')) {
                apiRoot += '/';
            }

            let headers = {};
            if (this._accessToken) {
                headers = {
                    'Authorization': `Bearer ${this._accessToken}`,
                };
            }

            request({
                url: `${apiRoot}get_${type}?file=${path}`,
				full_path: true,
                encoding: null,
                headers: headers,
            }, (err, httpResponse, body) => {
                if (err) {
                    reject(err);
                } else if (httpResponse >= 400) {
                    reject(new Error(`HTTP Error ${httpResponse} while fetching files`));
                } else {
					const info = JSON.parse(body);
                    resolve(info.data.file);
                }
            });
        });
    }

    async image(file) {
        // 获取cqimg文件内容中的实际url
        const url = await this._fetchFile(`${file}`, 'image');
		// test
		await new Promise(r => setTimeout(r, 1000));
        return url;
    }

    async voice(file) {
        const url = await this._fetchFile(`${file}`, 'record');
		// test
		await new Promise(r => setTimeout(r, 1000));
		return url;
    }

    async start() {
        if (!this._started) {
            this._started = true;
            this._client.connect();
        }
    }

    async stop() {
        if (this._started) {
            this._started = false;
            this._client.stop();
        }
    }
}

module.exports = QQWSApiMessageHandler;
