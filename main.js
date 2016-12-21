"use strict";

var utils = require(__dirname + '/lib/utils');
var adapter = utils.adapter('mpd');

var mpd = require('mpd'),
    cmd = mpd.cmd;
var statePlay = {
    'fulltime': 0,
    'curtime': 0,
    'Id': 0,
    'isPlay': false,
    'iSsay': false,
    'volume': 0,
    'mute_vol':0,
    'songid': null
};
var client, timer, int, sayTimer;
//var isPlay = false;
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
                var ids = id.split(".");
                var command = ids[ids.length - 1].toString();
                var val = [state.val];
                if (state.val === false || state.val === 'false'){
                    val = [0];
                } else if (state.val === true || state.val === 'true'){
                    val = [1];
                }
                
                switch (command) {
                  case 'volume':
                    command = 'setvol';
                    break;
                  case 'play':
                    val = [0];
                    break;
                  case 'mute':
                    command = 'setvol';
                    if (state.val === true || state.val === 'true'){
                        statePlay.mute_vol = statePlay.volume;
                        val = [0];
                    } else {
                        val = [statePlay.mute_vol];
                    }
                    break;
                  case 'progressbar':
                    command = 'seekcur';
                    val = [parseInt((statePlay.fulltime/100)*val[0], 10)];
                    break;
                  case 'next':
                  case 'previous':
                  case 'stop':
                  case 'playlist':
                  case 'clear':
                    val = [];
                    break;
                  default:
                    
                }
                
                if (~val.toString().indexOf(',')){
                    val = val.toString().split(',');
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
                            //GetStatus(["stats"]); //"currentsong", "status",
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
                GetStatus(["currentsong", "status", "stats"]);
            });
        }
    });
}
function sayit(command, val){
    var flag = false;
    if (statePlay.isPlay && !statePlay.iSsay){
        var vol = statePlay.volume;
        var id = statePlay.Id;
        var cur = statePlay.curtime;
        flag = true;
    }
    statePlay.iSsay = true;
    Sendcmd('addid', val, function(msg){
        msg = mpd.parseKeyValueMessage(msg);
        if (msg.Id){
            var say_id = msg.Id;
            Sendcmd('playid', [say_id], function(msg){
               // Sendcmd('setvol', [vol], function(msg){
                    GetStatus(["status"]);
                    if (flag){
                        flag = false;
                        sayTimePlay(say_id , id, cur, vol);
                    } else {
                        sayTimeDelete(say_id);
                    }
               // });
            });
        }
    });
}
function sayTimeDelete(say_id){
    clearTimeout(sayTimer);
    sayTimer = setTimeout(function (){
        if (statePlay.isPlay){
            sayTimeDelete(say_id);
        } else {
            Sendcmd('deleteid', [say_id], function(msg){
                statePlay.iSsay = false;
                return;
            });
        }
    }, 2000);
}
function sayTimePlay(say_id , id, cur, vol){
    clearTimeout(sayTimer);
    sayTimer = setTimeout(function (){
        if (statePlay.isPlay){
            sayTimePlay(say_id , id, cur, vol);
        } else {
            Sendcmd('seekid', [id, cur], function(msg){
                Sendcmd('setvol', [vol], function(msg){
                    Sendcmd('deleteid', [say_id], function(msg){
                        statePlay.iSsay = false;
                        return;
                    });
                });
            });
        }
    }, 2000);
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
    statePlay.isPlay = false;
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
                status = ["currentsong", "status", "stats"];
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
                            if (status === 'status'){
                                if (key === 'songid'){
                                    if (obj[key] !== statePlay.songid){
                                        statePlay.songid = obj[key];
                                        clearTag();
                                    }
                                }
                                if (key === 'time'){
                                    var prs = obj[key].toString().split(":");
                                    statePlay.curtime = parseInt(prs[0], 10);
                                    statePlay.fulltime = parseInt(prs[1], 10);
                                    SetObj('progressbar', parseFloat((parseFloat(prs[0]) * 100)/parseFloat(prs[1])).toFixed(2));
                                } else {
                                    statePlay[key] = obj[key];
                                }
                            }
                            if (status === 'currentsong'){
                                if (key === 'Id'){
                                    statePlay[key] = obj[key];
                                }
                            }
                            if (key === 'state' && obj[key] === 'stop'){
                                statePlay.isPlay = false;
                                clearTag();
                            }
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
                statePlay.isPlay = true;
            }
            adapter.setState(state, {val: val, ack: true});
        } else {
            if (state === 'state' && val === 'play'){
                statePlay.isPlay = true;
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
    if (statePlay.isPlay){
        int = setTimeout(function (){
            //statePlay.isPlay = false;
            GetStatus(["currentsong", "status"]);
        }, 1000);
    }
}
function clearTag(){
    var tag = ['error', 'Album', 'Artist', 'Composer', 'Date', 'Disc', 'Genre', 'Track', 'Id', 'Title', 'Name', 'AlbumArtist'];
    tag.forEach(function(n){
        adapter.setState(n, {val: '', ack: true});
    });
}

