'use strict';

const winston = require('winston');
const BridgeMsg = require('./transport/BridgeMsg.js');
const gt_languages = require('../gt_languages.json');

function describe_lang(lc) {
    const info = gt_languages[lc]
    if (!info) return lc
    return `${lc} 「${info.en} / ${info.zh}」`
}

function rand_language() {
    const languages = Object.keys(gt_languages)
    return languages[Math.floor(Math.random() * languages.length)]
}

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
        if (to == 'rand') {
            to = rand_language()
        }
        const [translation] = await translate.translate(str, to);
        return reply(context, `[${describe_lang(detection.language)} -> ${describe_lang(to)}] ${translation}`)
    };

    const gt_randx = (n, show_mid) => async context => {
        if (context.isPrivate) return;
        if (!options.enables.includes(context._to_uid)) return;
        var str = ""
        if (context.extra.reply && context.extra.reply.message) {
            str = context.extra.reply.message
        } else {
            str = context.param
        }
        if (str == '') return;
        winston.debug(`[gtrans.js] Translating ${str} for ${n} steps`);
        let [detection] = await translate.detect(str);
        var language_sequence = [detection.language]
        var str_sequence = [str]
        for (var i = 0; i < n; i++) {
            const to = rand_language()
            const [translation] = await translate.translate(str, to);
            str = translation
            str_sequence.push(str)
            language_sequence.push(to)
        }
        if (show_mid) {
            let parts = []
            for (var i = 0; i < n; i++) {
                parts.push(`[${describe_lang(language_sequence[i])} -> ${describe_lang(language_sequence[i+1])}]\n${str_sequence[i+1]}\n`)
            }
            return reply(context, `${str_sequence[0]}\n\n${parts.join('\n')}`)
        } else {
            return reply(context, `[${language_sequence.map(describe_lang).join(' -> ')}] ${str}`)
        }
    };
    
    if (bridge) {
        bridge.addCommand('!gt', gt, options);
        bridge.addCommand('!gtrand5x', gt_randx(5, true), options);
        bridge.addCommand('!gtrand5', gt_randx(5, false), options);
        bridge.addCommand('!gtrand10', gt_randx(10, false), options);
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
