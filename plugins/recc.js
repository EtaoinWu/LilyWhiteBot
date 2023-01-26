'use strict';

const winston = require('winston');
const BridgeMsg = require('./transport/BridgeMsg.js');
const ytpl = require("ytpl")

const music_urls = {
    vylet:  "PLXO_EoOinL6EBz6GlH82wWoxGEWwYbc8P",
    "4efb": "PLu58e_7jZWti07gKCE4fSnNtC5-A1lo22",
    wuy:    "PLN6Td1o9GnAyIxVQ2iFSUKJr5Y-g1APLI",
    "p@d":  "UUSJW3EMxeuQXZ00h4bihXvA",
    caleb:  "PLIDn91pIwQC87p1FAUV-RXbHm-g7sBcSv",
    celeste:"PLY9u9wC7ApRJk-tG4_pBtH6ubEJ7svnOB"
}

const help_str = `Music Recommendation. \nUsage: !rec [playlist]. \nPlaylists: ${JSON.stringify(Object.keys(music_urls))}`

module.exports = (pluginManager, options) => {
    const bridge = pluginManager.plugins.transport;
    const Broadcast = pluginManager.global.Broadcast;

    const fail = (context, str) => {
        winston.debug(`[recc.js] Msg #${context.msgId} fail: ${str}`);

        context.reply(str);
        if (bridge && !context.isPrivate) {
            bridge.send(new BridgeMsg(context, {
                text: `recommend: ${str}`,
                isNotice: true,
            }));
        }
    }

    const reply = (context, str) => {
        winston.debug(`[recc.js] Msg #${context.msgId} reply: ${str}`);
        
        context.reply(str);
        if (bridge && !context.isPrivate) {
            bridge.send(new BridgeMsg(context, {
                text: `recommend: ${str}`,
                isNotice: true,
            }));
        }
    }

    const recc = async context => {
        const params = context.param.split(" ")
        if(params.length < 1) {
            return fail(context, help_str)
        }
        let playlist = params[0]
        if(!music_urls[playlist]) {
            return fail(context, help_str)
        }
        let playlist_url = music_urls[playlist]
        let song_urls = await ytpl(playlist_url, {limit: 1000})
        song_urls = song_urls.items
        let result = song_urls[parseInt(Math.random() * song_urls.length)].url
        reply(context, result)
    };

    if (bridge) {
        bridge.addCommand('!recc', recc, options);
        bridge.addCommand('!rec', recc, options);
    } else {
        for (let [type, handler] of pluginManager.handlers) {
            handler.addCommand('!recc', recc);
            handler.addCommand('!rec', recc);
        }
    }
};
