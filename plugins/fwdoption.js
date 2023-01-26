/*
 * fwdoption
 * 
 * /fwd on, /fwd off
 */
'use strict';

const winston = require('winston');
const BridgeMsg = require('./transport/BridgeMsg.js');


module.exports = (pluginManager, options) => {
    const bridge = pluginManager.plugins.transport;
    const Broadcast = pluginManager.global.Broadcast;

    const fwdoption = context => {
    };

    if (bridge) {
        bridge.addCommand('!fwd', fwdoption, options);
    } else {
        for (let [type, handler] of pluginManager.handlers) {
            handler.addCommand('!fwd', fwdoption);
        }
    }
};
