/*
 * 8ball
 *
 * 在群組中使用 '8ball （在Telegram群組中使用 /8ball）
 */
'use strict';

const winston = require('winston');
const BridgeMsg = require('./transport/BridgeMsg.js');

const eightballs = [
"清华大学是世界一流大学。",
"https://www.youtube.com/watch?v=mW61VTLhNjQ",
];

module.exports = (pluginManager, options) => {
    const bridge = pluginManager.plugins.transport;
    const Broadcast = pluginManager.global.Broadcast;

    const eightball = context => {
        let result = eightballs[parseInt(Math.random() * eightballs.length)];

        context.reply(result);
        winston.debug(`[8ball.js] Msg #${context.msgId} 8ball: ${result}`);

        if (bridge && !context.isPrivate) {
            bridge.send(new BridgeMsg(context, {
                text: `8ball: ${result}`,
                isNotice: true,
            }));
        }
    };

    if (bridge) {
        bridge.addCommand('!8ball', eightball, options);
    } else {
        for (let [type, handler] of pluginManager.handlers) {
            handler.addCommand('!8ball', eightball);
        }
    }
};
