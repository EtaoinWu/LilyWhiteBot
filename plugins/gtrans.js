'use strict';

const winston = require('winston');
const BridgeMsg = require('./transport/BridgeMsg.js');

module.exports = (pluginManager, options) => {
    if (!options.enables) options.enables = [];
    const {Translate} = require('@google-cloud/translate').v2;
    const translate = new Translate({ projectId: 'qq-bot-translate' });
    const bridge = pluginManager.plugins.transport;
    const Broadcast = pluginManager.global.Broadcast;
    const OpenCC = require('opencc');

    const reply = (context, str) => {
        winston.debug(`[gtrans.js] Msg #${context.msgId} reply: ${str}`);
        
        context.reply(str);
        if (bridge && !context.isPrivate) {
            bridge.send(new BridgeMsg(context, {
                text: str,
                isNotice: true,
            }));
        }
    }

    const occ_convert = config => {
        const converter = new OpenCC(config);
        return async context => {
            if (!options.enables.includes(context._to_uid)) return;
            if (context.isPrivate) return;
            var str = ""
            if (context.extra.reply && context.extra.reply.message) {
                str = context.extra.reply.message
            } else {
                str = context.param
            }
            winston.debug(`[gtrans.js] OpenCC ${str} via ${config}`);
            const result = await converter.convertPromise(str);
            return reply(context, result);
        }
    }

    const gt = async context => {
// console.log(context)
        if (context.isPrivate) return;
        if (!options.enables.includes(context._to_uid)) return;
        var str = ""
        var to = "en"
        if (context.extra.reply && context.extra.reply.message) {
            str = context.extra.reply.message
            if (context.param) {
                to = context.param.split(' ')[0]
            }
        } else {
            str = context.param
        }
        winston.debug(`[gtrans.js] Translating ${str} to ${to}`);
        let [detection] = await translate.detect(str);
        if (detection.language == 'en' && to == 'en') {
            to = 'zh-CN'
        }
        const [translation] = await translate.translate(str, to);
        return reply(context, `[${detection.language} -> ${to}] ${translation}`)
    };
    
    if (bridge) {
        bridge.addCommand('!gt', gt, options);
        bridge.addCommand('!s2t', occ_convert('s2twp.json'), options);
        bridge.addCommand('!t2s', occ_convert('tw2sp.json'), options);
    } else {
        for (let [type, handler] of pluginManager.handlers) {
            handler.addCommand('!gt', gt);
            handler.addCommand('!s2t', occ_convert('s2twp.json'));
            handler.addCommand('!t2s', occ_convert('tw2sp.json'));
        }
    }
};
