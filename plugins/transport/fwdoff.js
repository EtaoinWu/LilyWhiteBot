'use strict';

const winston = require('winston');
const BridgeMsg = require('./BridgeMsg.js');

module.exports = (bridge, options) => {
    const reply = (context, str) => {
        context.reply(str);
        if (bridge && !context.isPrivate) {
            bridge.send(new BridgeMsg(context, {
                text: str,
                isNotice: true,
            }));
        }
	return Promise.resolve();
    }
    const fwd = async ctx => {
//	console.log(ctx)
        if (ctx.isPrivate) return;
        var str = ctx.param
        if (!str) str = ""
        str = str.toLowerCase()
        var changed = " now"
        if (str.startsWith("on")
            || str.startsWith("yes")
            || str.startsWith("true")
            || str.startsWith("1")) {
            options.options.rpae.disabled = false
        } else if (str.startsWith("off")
                   || str.startsWith("no")
                   || str.startsWith("false")
                   || str.startsWith("0")) {
            options.options.rpae.disabled = true
        } else {
            changed = ""
        }

        if (options.options.rpae.disabled) {
            return reply(ctx, 'TG->QQ Forwarding is DISABLED' + changed + '. Whitelisting with ' + options.options.rpae.prepend + ' is REQUIRED.')
        } else {
            return reply(ctx, 'TG->QQ Forwarding is ENABLED' + changed + '. Whitelisting with ' + options.options.rpae.prepend + ' is NOT required.')
        }
    }
    
  
    bridge.addCommand('!fwd', fwd)
};
