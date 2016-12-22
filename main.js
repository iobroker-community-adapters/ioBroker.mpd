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
    'mute_vol':30,
    'songid': null
};
var connection = false;
var states = {};
var old_states = {};
var client, timer, int, sayTimer;

adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

adapter.on('message', function (obj) {
    var wait = false;
    if (obj) {
        if (obj.command === '.say'){ //TODO change command here and in text2speech
            if (obj.message) sayit('say', obj.message);
        }
    }
});

adapter.on('objectChange', function (id, obj) {
    adapter.log.debug('objectChange ' + id + ' ' + JSON.stringify(obj));
});

adapter.on('stateChange', function (id, state) {
    if (connection){
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
                mute(state.val);
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
                val = state.val;
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
    } else {
        adapter.log.error('Send command error - MPD NOT connected!');
    }
});

adapter.on('ready', function () {
    main();
});

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
        _connection(true);
        GetStatus(["status"]);
    });

    client.on('system', function(name) {
        adapter.log.debug("update system - " + JSON.stringify(name));
        switch (name) {
            case 'playlist':
                GetStatus(["playlist"]);
                break;
            default:
                //status = ["currentsong", "status", "stats"];
                GetStatus(["currentsong", "status", "stats"]);
        }
    });

    client.on('error', function(err) {
        if (err.syscall !== 'connect' && err.code !== 'ETIMEDOUT'){
            _connection(false);
            adapter.log.error("MPD Error " + JSON.stringify(err));
        }
    });

    client.on('end', function(name) {
        clearTimeout(timer);
        adapter.log.debug("connection closed", name);
        _connection(false);
        timer = setTimeout(function (){
            main();
        }, 5000);
    });

    adapter.subscribeStates('*'); //TODO JSON list commands
}
function _connection(state){
    if (state){
        connection = true;
        adapter.log.info("MPD ready!");
        adapter.setState('info.connection', true, true);
    } else {
        connection = false;
        adapter.setState('info.connection', false, true);
    } 
}
function GetStatus(arr){
    if (arr){
        arr.forEach(function(status){
            client.sendCommand(cmd(status, []), function (err, res){
                if (err) throw err;
                var obj = mpd.parseKeyValueMessage(res);
                adapter.log.debug('GetStatus - ' + JSON.stringify(obj));
                if (status === 'playlist'){
                    states['playlist_list'] = obj; //TODO Bring all playlists players to the same species
                } else {
                    for (var key in obj) {
                        if (obj.hasOwnProperty(key)){
                            states[key] = obj[key];
                        }
                    }
                    _shift();
                }
            });
        });
    }
}
function _shift(){
    if (states.songid !== statePlay.songid){
        statePlay.songid = obj[key];
        clearTag(); //TODO clear in states obj
    }
    var prs = states.time.toString().split(":");
    statePlay.curtime = parseInt(prs[0], 10);
    statePlay.fulltime = parseInt(prs[1], 10);
    var progress = parseFloat((parseFloat(prs[0]) * 100)/(statePlay.fulltime || 1)).toFixed(2);
    states['progressbar'] = progress || 0;
    
    if (states.state === 'stop'){
        statePlay.isPlay = false;
        clearTag();
    } else if (states.state === 'play'){
        statePlay.isPlay = true;
    }
    SetObj();
}
function SetObj(){
    for (var key in states) {
        if (obj.hasOwnProperty(key)){
            adapter.getObject(key, function(err, obj){
                if((err || !obj) && key){
                    adapter.log.info('Create new state - ' + key);
                    adapter.log.info('Please send a text this developer - ' + key);
                    adapter.setObject(key, {
                        type:   'state',
                        common: {
                            name: key,
                            type: 'state',
                            role: 'media.' + key
                        },
                        native: {}
                    }, function () {
                        adapter.setState(key, states[key], true);
                    });
                } else {
                    if (!old_states.hasOwnProperty(key)){
                        old_states[key] = null;
                    }
                    if (states[key] !== old_states[key]){
                        adapter.setState(key, states[key], true);
                    }
                }
            });
        }
    }
    old_states = states;
    GetTime();
}

/*function SetObj(state, val){
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
}*/

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
    tag.forEach(function(name){
        states[name] = '';
    });
}

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

function mute(val){
    command = 'setvol';
    if (val === true || val === 'true'){
        statePlay.mute_vol = statePlay.volume;
        val = [0];
    } else {
        val = [statePlay.mute_vol];
    }
}

function sayit(command, val){
    var fileName;
    var volume = null;
    var pos = val.indexOf(';');
    if (pos !== -1) {
        volume = val.substring(0, pos);
        fileName = val.substring(pos + 1);
    }
    var flag = false;
    if (statePlay.isPlay && !statePlay.iSsay){
        var vol = statePlay.volume;
        var id = statePlay.Id;
        var cur = statePlay.curtime;
        flag = true;
    }
    if (!statePlay.iSsay){
        Sendcmd('addid', [fileName], function(msg){
            statePlay.iSsay = true;
            msg = mpd.parseKeyValueMessage(msg);
            if (msg.Id){
                var say_id = msg.Id;
                Sendcmd('playid', [say_id], function(msg){
                    Sendcmd('setvol', [volume], function(msg){
                        GetStatus(["status"]);
                        if (flag){
                            flag = false;
                            sayTimePlay(say_id , id, cur, vol);
                        } else {
                            sayTimeDelete(say_id);
                        }
                    });
                });
            }
        });
    } else {
        setTimeout(function (){
            sayit(command, val);
        }, 1000);
    }
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

