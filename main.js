"use strict";

var utils = require(__dirname + '/lib/utils');
var adapter = utils.adapter('mpd');

var mpd = require('mpd'),
    cmd = mpd.cmd;

var client;
adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

adapter.on('objectChange', function (id, obj) {
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

adapter.on('stateChange', function (id, state) {
    adapter.getState('info.connection', function (err, st) {
        if (st || !err){
            if (state && !state.ack) {
                adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));
                adapter.log.info('ack is not set!');

                var val = state.val;
                if (val === false || val === 'false'){
                    val = 0;
                } else {
                    val = 1;
                }
                var ids = id.split(".");
                var command = ids[ids.length - 1].toString();

                client.sendCommand(cmd(command, [val]), function(err, msg) {
                    if (err) throw err;
                    adapter.log.info(msg);
                    client.sendCommand(cmd("status", []), function(err, msg) {
                        if (err) throw err;
                        adapter.log.info(msg);
                        parse_msg(msg);
                    });
                });
            }
        }
    });
});

adapter.on('ready', function () {
    main();
});

function main() {
    client = mpd.connect({
        host: adapter.config.ip || '192.168.1.190',
        port: adapter.config.port || 6600
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
            parse_msg(msg);
        });
    });

    client.on('error', function(err) {
        adapter.log.error("MPD Error", err);
    });

    client.on('end', function(name) {
        adapter.log.info("connection closed", name);
        adapter.setState('info.connection', false, true);
        setTimeout(function (){
            main();
        }, 5000);
    });
    /*adapter.setObject('play', {
        type: 'state',
        common: {
            name: 'play',
            type: 'boolean',
            role: 'indicator'
        },
        native: {}
    });*/

    adapter.subscribeStates('*');
}
function parse_msg(msg){
    var arr = msg.split('\n');
    var state = '';
    var val;
    arr.forEach(function(item){
        if (item.length > 0){
            adapter.log.debug('SetObj - ' + JSON.stringify(item));
            var _arr = item.split(' ');
            state = _arr[0].replace(':', '');
            val = _arr[1];
            //adapter.log.debug('SetObj - ' + JSON.stringify(arr));
            setObj(state, val);
        }
    });
}
function setObj(state, val){
    adapter.getState(state, function (err, st){
        if ((err || !st) && state){
            adapter.log.debug('get SetObj - ' + state);
            adapter.setObject(state, {
                type:   'state',
                common: {
                    name: state,
                    type: 'state',
                    role: 'media'
                },
                native: {}
            });
            adapter.setState(state, {val: val, ack: true});
        } else {
            adapter.setState(state, {val: val, ack: true});
        }
    });
}