/*
 * 8ball
 *
 * 在群組中使用 '8ball （在Telegram群組中使用 /8ball）
 */
'use strict';

const winston = require('winston');
const BridgeMsg = require('./transport/BridgeMsg.js');

const eightballs = [
"对三，要不起。",
"躺平！",
"差不多得了！",
"谁说你不会乐器，你退堂鼓打的可好了！",
"That's the gayest shit I've ever seen.",
"You don't have a nightmare if you never dream.",
"就这？",
"就这？就这？就这？",
"清华大学是世界一流大学。",
"😅",
"你在教我做事？",
"https://www.youtube.com/watch?v=mW61VTLhNjQ",
"多少沾点😅",
"不会吧不会吧？",
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
