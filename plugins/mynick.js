/*
 * 8ball
 *
 * 在群組中使用 !mynick （在Telegram群組中使用 /mynick）
 */
'use strict';

const winston = require('winston');
const BridgeMsg = require('./transport/BridgeMsg.js');
const { namedb, get_name } = require('../lib/db.js');
const { ansiEscapeCodes, zeroWidthCharacters } = require ('printable-characters')
const stringify = require ('string.ify')
const { pastebin } = require('../lib/pastebin.js')

module.exports = (pluginManager, options) => {
    const bridge = pluginManager.plugins.transport;
    const Broadcast = pluginManager.global.Broadcast;

    const reply_text = async (ctx, result) => {
        if (result.length > 2000) result = await pastebin(result);
        winston.debug(`[mynick.js] Msg #${ctx.msgId}: ${result}`);
        ctx.reply(result);

        if (bridge && !ctx.isPrivate) {
            bridge.send(new BridgeMsg(ctx, {
                text: `${result}`,
                isNotice: true,
            }));
        }
    }

    const fn_nick = async id => {
        let res = await get_name(id)
        if (typeof res === 'string') return `"${res}"`
        return "None"
    }

    const mynick = async context => {
        let uid = context.extra.unified_id
        let nick_text = await fn_nick(uid)
        reply_text(context, `Unified ID: ${uid}\nNickname: ${nick_text}`);
    };

    const nick = async context => {
        if (context.extra.reply && context.extra.reply.unified_to_id) {
            let uid = context.extra.reply.unified_to_id
            let nick_text = await fn_nick(uid)
            reply_text(context, `Replied Unified ID: ${uid}\n` +
                                `Nickname: ${nick_text}`);
        } else return mynick(context);
    }

    const delnick_base = q => async context => {
        let id = context.extra.unified_id;
        let sender = id;
        if (context.extra.reply && context.extra.reply.unified_to_id)
            id = context.extra.reply.unified_to_id;
        if (!options.admin.includes(sender))
            return reply_text(context, `You (${sender}) cannot change the nickname of ${id}.`);
        let old_nick_text = await fn_nick(id)
        await namedb.del(id);
        if (q) return;
        return reply_text(context, `Removed nickname of ${id} (originally ${old_nick_text}) ` +
                                   `successful.`);
    }

    const setnick_base = q => async context => {
        let id = context.extra.unified_id;
        let sender = id;
        if (context.extra.reply && context.extra.reply.unified_to_id)
            id = context.extra.reply.unified_to_id;
        if (!options.admin.includes(sender))
            return reply_text(context, `You (${sender}) cannot change the nickname of ${id}.`);
        let old_nick_text = await fn_nick(id)
        let new_nick = context.param || ""
        new_nick = new_nick.trim().replace(ansiEscapeCodes, '').replace(zeroWidthCharacters, '')
        if (new_nick.length < 2)
            return reply_text(context, `Expect name length >= 2, ` +
                                       `got "${new_nick}" with length ${new_nick.length}`);
        if (new_nick.length > 42)
            return reply_text(context, `Expect name length <= 42, ` +
                                       `got "${new_nick}" with length ${new_nick.length}`);
        await namedb.put(id, new_nick);
        if (q) return;
        return reply_text(context, `Changed nickname of ${id} from ${old_nick_text} ` +
                                   `to "${new_nick}" successful.`);
    }
    const setnick = setnick_base(false);
    const setnickq = setnick_base(true);

    const getnicktable = async context => {
        let sender = context.extra.unified_id;
        if (!options.admin.includes(sender))
            return reply_text(context, `You (${sender}) cannot get nickname table.`);
        let result = {}
        for await (const [k, v] of namedb.iterator()) {
            result[k] = v;
        }
        return reply_text(context, stringify(result));
    }

    if (bridge) {
        bridge.addCommand('!mynick', mynick, options);
        bridge.addCommand('!nick', nick, options);
        bridge.addCommand('!setnick', setnick, options);
        bridge.addCommand('!setnickq', setnickq, options);
        bridge.addCommand('!delnick', delnick_base(false), options);
        bridge.addCommand('!delnickq', delnick_base(true), options);
        bridge.addCommand('!getnicktable', getnicktable, options);
    } else {
        for (let [type, handler] of pluginManager.handlers) {
            handler.addCommand('!mynick', mynick);
            handler.addCommand('!nick', nick);
            handler.addCommand('!setnick', setnick);
            handler.addCommand('!setnickq', setnickq);
            handler.addCommand('!delnick', delnick_base(false));
            handler.addCommand('!delnickq', delnick_base(true));
            handler.addCommand('!getnicktable', getnicktable);
        }
    }
};
