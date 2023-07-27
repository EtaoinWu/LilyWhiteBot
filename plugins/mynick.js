/*
 * 8ball
 *
 * 在群組中使用 !mynick （在Telegram群組中使用 /mynick）
 */
'use strict';

const winston = require('winston');
const BridgeMsg = require('./transport/BridgeMsg.js');
const { namedb, get_name } = require('../lib/db.js');

module.exports = (pluginManager, options) => {
    const bridge = pluginManager.plugins.transport;
    const Broadcast = pluginManager.global.Broadcast;

    const reply_text = (ctx, result) => {
        ctx.reply(result);
        winston.debug(`[mynick.js] Msg #${ctx.msgId}: ${result}`);

        if (bridge && !ctx.isPrivate) {
            bridge.send(new BridgeMsg(ctx, {
                text: `${result}`,
                isNotice: true,
            }));
        }
    }

    const mynick = context => {
        reply_text(context, `Unified ID: ${context.extra.unified_id}\nNickname: ${context.nick}`);
    };

    const nick = async context => {
        if (context.extra.reply && context.extra.reply.unified_to_id) {
            reply_text(context, `Unified ID: ${context.extra.reply.unified_to_id}\n` +
                                `Nickname: ${context.extra.reply.nick}`);
        } else return mynick(context);
    }

    const setnick = async context => {
        let id = context.extra.unified_id;
        let sender = id;
        if (context.extra.reply && context.extra.reply.unified_to_id)
            id = context.extra.reply.unified_to_id;
        if (sender != id && !options.admin.includes(sender))
            return reply_text(context, `You (${sender}) cannot change the nickname of ${id}.`);
        let new_nick = context.param || ""
        new_nick = new_nick.trim()
        if (new_nick.length < 2)
            return reply_text(context, `Expect name length >= 2, ` +
                                       `got "${new_nick}" with length ${new_nick.length}`);
        await namedb.put(id, new_nick);
        return reply_text(context, `Changed nickname of ${id} to ` +
                                   `"${new_nick}" successful.`);
    }

    if (bridge) {
        bridge.addCommand('!mynick', mynick, options);
        bridge.addCommand('!nick', nick, options);
        bridge.addCommand('!setnick', setnick, options);
    } else {
        for (let [type, handler] of pluginManager.handlers) {
            handler.addCommand('!mynick', mynick);
            handler.addCommand('!nick', nick);
            handler.addCommand('!setnick', setnick);
        }
    }
};
