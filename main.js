"use strict";

var utils = require(__dirname + '/lib/utils');
var adapter = utils.adapter('mpd');

var mpd = require('mpd'),
    cmd = mpd.cmd;

adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        client.socket.close();
        callback();
    } catch (e) {
        callback();
    }
});

adapter.on('objectChange', function (id, obj) {
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

adapter.on('stateChange', function (id, state) {
    if (state && !state.ack) {
        adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));
        adapter.log.info('ack is not set!');
        
    }
});

adapter.on('ready', function () {
    main();
});

function main() {
    var client = mpd.connect({
        port: adapter.config.port || 6600,
        host: adapter.config.ip || '192.168.1.190'
    });

    client.on('ready', function() {
        adapter.log.info("ready");
        adapter.setState('info.connection', true, true);
    });

    client.on('system', function(name) {
        adapter.log.info("update-", name);
        
    });

    client.on('system-player', function() {
        client.sendCommand(cmd("status", []), function(err, msg) {
            if (err) throw err;
            adapter.log.info(msg);
        });
    });

    client.on('error', function(err) {
        adapter.log.error("MPD Error", err);
    });

    client.on('end', function(name) {
        adapter.log.info("connection closed", name);
        adapter.setState('info.connection', false, true);
        client.socket.close();
        setTimeout(function (){
            main();
        }, 5000);
    });
    
   /* adapter.setObject('testVariable', {
        type: 'state',
        common: {
            name: 'testVariable',
            type: 'boolean',
            role: 'indicator'
        },
        native: {}
    });*/

    adapter.subscribeStates('*');

    /*adapter.setState('testVariable', true);
    adapter.setState('testVariable', {val: true, ack: true});
    adapter.setState('testVariable', {val: true, ack: true, expire: 30});*/




}
