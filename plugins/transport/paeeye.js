'use strict';

const winston = require('winston');
const BridgeMsg = require('./BridgeMsg.js');

module.exports = (bridge, options) => {
    bridge.addHook('bridge.send', (msg) => new Promise((resolve, reject) => {

    let rpae = options.options.rpae;
	if (msg._to_client == 'Telegram' && rpae && rpae.disabled) {
	    if (msg.text.toUpperCase().startsWith(rpae.prepend) ||
		msg.text.toUpperCase().includes(rpae.inline) ||
		msg.text.toUpperCase().includes(rpae.inline2)) {
		resolve();
		return;
	    }

	    winston.debug(`[paeeye.js] #${msg.msgId}: Ignored.`);
	    reject(false);
	    return;
	}
        let paeeye = options.options.paeeye;

        if (paeeye) {
            if (typeof paeeye === 'string') {
                if (msg.text.toUpperCase().startsWith(paeeye) ||
                    (msg.extra.reply && msg.extra.reply.message.toUpperCase().startsWith(paeeye))) {
                    winston.debug(`[paeeye.js] #${msg.msgId}: Ignored.`);
                    reject(false);
                    return;
                }
            } else {
                if (msg.text.toUpperCase().startsWith(paeeye.prepend) ||
                    msg.text.toUpperCase().includes(paeeye.inline)) {
                    winston.debug(`[paeeye.js] #${msg.msgId}: Ignored.`);
                    reject(false);
                    return;
                } else if (msg.extra.reply && (msg.extra.reply.message.toUpperCase().startsWith(paeeye.prepend) ||
                    msg.extra.reply.message.toUpperCase().includes(paeeye.inline))) {
                    winston.debug(`[paeeye.js] #${msg.msgId}: Ignored.`);
                    reject(false);
                    return;
                }
            }
        }
        resolve();
    }));
};

