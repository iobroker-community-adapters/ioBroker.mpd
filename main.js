"use strict";

var utils =    require(__dirname + '/lib/utils');
var adapter = utils.adapter('mpd');

var mpd = require('mpd'),
    cmd = mpd.cmd;

adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed object changes
adapter.on('objectChange', function (id, obj) {
    // Warning, obj can be null if it was deleted
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // Warning, state can be null if it was deleted
    adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        adapter.log.info('ack is not set!');
    }
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
    if (typeof obj == 'object' && obj.message) {
        if (obj.command == 'send') {
            // e.g. send email or pushover or whatever
            console.log('send command');

            // Send response in callback if required
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    main();
});

function main() {
    var client = mpd.connect({
        port: 6600,
        host: '192.168.1.190'
    });
    client.on('ready', function() {
        adapter.log.info("ready");
    });
    client.on('system', function(name) {
        adapter.log.info("update", name);
    });
    client.on('system-player', function() {
        client.sendCommand(cmd("status", []), function(err, msg) {
            if (err) throw err;
            adapter.log.info(msg);
        });
    });


    // adapter.config:
    adapter.log.info('config test1: ' + adapter.config.test1);
    adapter.log.info('config test1: ' + adapter.config.test2);

    adapter.setObject('testVariable', {
        type: 'state',
        common: {
            name: 'testVariable',
            type: 'boolean',
            role: 'indicator'
        },
        native: {}
    });

    // in this mpd all states changes inside the adapters namespace are subscribed
    adapter.subscribeStates('*');

    /*adapter.setState('testVariable', true);
    adapter.setState('testVariable', {val: true, ack: true});
    adapter.setState('testVariable', {val: true, ack: true, expire: 30});*/


    adapter.checkPassword('admin', 'iobroker', function (res) {
        console.log('check user admin pw ioboker: ' + res);
    });

    adapter.checkGroup('admin', 'admin', function (res) {
        console.log('check group user admin group admin: ' + res);
    });



}
