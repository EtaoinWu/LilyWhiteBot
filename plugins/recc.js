'use strict';

const winston = require('winston');
const BridgeMsg = require('./transport/BridgeMsg.js');
const ytpl = require("ytpl");

module.exports = (pluginManager, options) => {
    let music_urls = options.playlists;
    function help_str() {
        return `Music Recommendation. \nUsage: !rec [playlist]. \nPlaylists: ${JSON.stringify(Object.keys(music_urls))}`
    }

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
            return fail(context, help_str())
        }
        let playlist = params[0]
        if(!music_urls[playlist]) {
            return fail(context, help_str())
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
