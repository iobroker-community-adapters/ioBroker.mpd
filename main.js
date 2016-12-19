"use strict";

var utils = require(__dirname + '/lib/utils');
var adapter = utils.adapter('mpd');

var mpd = require('mpd'),
    cmd = mpd.cmd;

var client, timer, int;
var isPlay = false;
adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

adapter.on('objectChange', function (id, obj) {
    adapter.log.debug('objectChange ' + id + ' ' + JSON.stringify(obj));
});

adapter.on('stateChange', function (id, state) {
    adapter.getState('info.connection', function (err, st) {
        if (st || !err){
            if (state && !state.ack) {
                adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
                var val = [state.val];
                if (state.val === false || state.val === 'false'){
                    val = [0];
                } else if (state.val === true || state.val === 'true'){
                    val = [1];
                }
                if (~val.toString().indexOf(',')){
                    val = val.toString().split(',');
                }
                var ids = id.split(".");
                var command = ids[ids.length - 1].toString();
                if (command === 'volume'){
                    command = 'setvol';
                }
                if (command === 'play'){
                    val = [0];
                }
                if (command === 'next' || command === 'previous' || command === 'stop' || command === 'playlist'){
                    val = [];
                }
                if (command === 'say'){
                    sayit(command, val);
                } else if (command === 'addplay'){
                    addplay('addid', val);
                } else {
                    client.sendCommand(cmd(command, val), function(err, msg) {
                        if (err){
                            adapter.log.error('client.sendCommand {"'+command+'": "'+val+'"} ERROR - ' + err);
                        } else {
                            adapter.log.info('client.sendCommand {"'+command+'": "'+val+'"} OK! - ' + JSON.stringify(msg));
                            GetStatus(["status", "currentsong", "stats"]);
                        }
                    });
                }
            }
        }
    });
});

adapter.on('ready', function () {
    main();
});
function addplay(command, val){
    command = 'addid';
    Sendcmd(command, val, function(msg){
        msg = mpd.parseKeyValueMessage(msg);
        if (msg.Id){
            command = 'playid';
            val = [msg.Id];
            Sendcmd(command, val, function(msg){
                GetStatus(["status", "currentsong", "stats"]);
            });
        }
    });
}
function sayit(command, val){
    command = 'addid';
    Sendcmd(command, val, function(msg){
        msg = mpd.parseKeyValueMessage(msg);
        if (msg.Id){
            command = 'playid';
            val = [msg.Id];
            Sendcmd(command, val, function(msg){
                command = 'deleteid';
                setTimeout(function (){
                    Sendcmd(command, val, function(msg){
                        return;
                    });
                }, 60000);
            });
        }
    });
}
function Sendcmd(command, val, callback){
    client.sendCommand(cmd(command, val), function(err, msg) {
        if (err){
            adapter.log.error('client.sendCommand {"'+command+'": "'+val+'"} ERROR - ' + err);
            return;
        } else {
            adapter.log.info('client.sendCommand {"'+command+'": "'+val+'"} OK! - ' + JSON.stringify(msg));
            callback(msg);
        }
    });
}
function main() {
    var status = [];
    isPlay = false;
    client = mpd.connect({
        host: adapter.config.ip || '192.168.1.10',
        port: adapter.config.port || 6600
    });
    client.on('ready', function() {
        adapter.log.info("MPD ready!");
        adapter.setState('info.connection', true, true);
        GetStatus(["status"]);
    });

    client.on('system', function(name) {
        adapter.log.debug("update system - " + JSON.stringify(name));
        switch (name) {
            case 'playlist':
                GetStatus(["playlist"]);
                break;
            default:
                status = ["status", "currentsong", "stats"];
                GetStatus(status);
        }
    });

    client.on('error', function(err) {
        if (err.syscall === 'connect' && err.code === 'ETIMEDOUT'){
            
        } else {
            adapter.log.error("MPD Error " + JSON.stringify(err));
        }
    });

    client.on('end', function(name) {
        clearTimeout(timer);
        adapter.log.debug("connection closed", name);
        adapter.setState('info.connection', false, true);
        timer = setTimeout(function (){
            main();
        }, 5000);
    });

    adapter.subscribeStates('*'); //TODO JSON list commands
}
function GetStatus(arr){
    if (arr){
        arr.forEach(function(status){
            client.sendCommand(cmd(status, []), function (err, res){
                if (err) throw err;
                var obj = mpd.parseKeyValueMessage(res);
                adapter.log.debug('GetStatus - ' + JSON.stringify(obj));
                if (status === 'playlist'){
                    SetObj('playlist_list', obj);
                } else {
                    for (var key in obj) {
                        if (obj.hasOwnProperty(key)){
                            SetObj(key, obj[key]);
                        }
                    }
                }
            });
        });
    }
}

function SetObj(state, val){
    adapter.getState(state, function (err, st){
        if ((err || !st) && state){
            adapter.log.info('Create new state - ' + state);
            adapter.log.info('Please send a text this developer - ' + state);
            adapter.setObject(state, {
                type:   'state',
                common: {
                    name: state,
                    type: 'state',
                    role: 'media.'+state
                },
                native: {}
            });
            if (state === 'state' && val === 'play'){
                isPlay = true;
            }
            adapter.setState(state, {val: val, ack: true});
        } else {
            if (state === 'state' && val === 'play'){
                isPlay = true;
            }
            if (st.val !== val){
                adapter.setState(state, {val: val, ack: true});
            }
        }
        GetTime();
    });
}
function GetTime(){
    clearTimeout(int);
    if (isPlay){
        int = setTimeout(function (){
            isPlay = false;
            GetStatus(["status"]);
        }, 1000);
    }
}
/**
 error
 Name
 */