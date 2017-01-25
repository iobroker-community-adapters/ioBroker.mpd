"use strict";

var utils = require(__dirname + '/lib/utils');
var adapter = utils.adapter('mpd');
var mpd = require('mpd'), cmd = mpd.cmd;
var statePlay = {
    'fulltime': 0,
    'curtime': 0,
    'Id': 0,
    'isPlay': false,
    'iSsay': false,
    'sayid': null,
    'volume': 0,
    'mute_vol':30,
    'songid': null
};
var playlist = [];
var connection = false;
var states = {}, old_states = {};
var client, timer, int;

adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

adapter.on('message', function (obj) {
    if (obj) {
        if (obj.command === 'say'){
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
                if (val[0] < 0) val[0] = 0;
                if (val[0] > 100) val[0] = 100;
                  val[0] = parseInt(val[0], 10);
                break;
              case 'play':
                val = [0];
                break;
              case 'playid':
                command = 'play';
                break;
              case 'mute':
                command = 'setvol';
                val = mute(state.val);
                break;
              case 'seek':
                command = 'seekcur';
                if (val[0] < 0) val[0] = 0;
                if (val[0] > 100) val[0] = 100;
                  val[0]= parseInt(val[0], 10);
                  var full = statePlay.fulltime;
                val = [parseInt((full/100)*val[0], 10)];
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
                if(val){
                    sayit(command, val);
                }
            } else if (command === 'addplay'){
                addplay('addid', val);
            } else {
                client.sendCommand(cmd(command, val), function(err, msg) {
                    if (err){
                        adapter.log.error('client.sendCommand {"'+command+'": "'+val+'"} ERROR - ' + err);
                    } else {
                        if (command !== 'setvol'){
                            adapter.log.debug('client.sendCommand {"'+command+'": "'+val+'"} OK!');
                        } else {
                            adapter.log.debug('client.sendCommand {"' + command + '": "' + val + '"} OK! - ' + JSON.stringify(msg));
                        }
                        if (command === 'lsinfo'){
                            filemanager(val, msg);
                        }
                        /*if (command === 'clear'){
                            GetStatus(['status','playlist']);
                        }*/
                    }
                });
            }
        }
    } else {
        adapter.log.debug('Send command error - MPD NOT connected!');
    }
});

adapter.on('ready', function () {
    main();
});

function Sendcmd(command, val, callback){
    client.sendCommand(cmd(command, val), function(err, msg) {
        if (err){
            if (command !== 'setvol'){
                adapter.log.error('client.sendCommand {"' + command + '": "' + val + '"} ERROR - ' + err);
            }
            if (callback){
                callback(msg, err);
            } else { return;}
        } else {
            adapter.log.debug('client.sendCommand {"' + command + '": "' + val + '"} OK! - ' + JSON.stringify(msg));
            callback(msg);
        }
    });
}
function main() {
    var status = [];
    statePlay.isPlay = false;
    client = mpd.connect({
        host: adapter.config.ip || '127.0.0.1',
        port: adapter.config.port || 6600
    });
    client.on('ready', function() {
        _connection(true);
        GetStatus(['status','playlist']);
    });

    client.on('system', function(name) {
        //adapter.log.debug("update system - " + JSON.stringify(name));
        switch (name) {
            case 'playlist':
                GetStatus(["playlist"]);
                break;
            default:
                if (name !== 'mixer' && !statePlay.iSsay){
                    GetStatus(["currentsong", "status", "stats"]);
                }
        }
    });

    client.on('error', function(err) {
        if (err.syscall !== 'connect' && err.code !== 'ETIMEDOUT'  && err.code !== 'ENOTFOUND' && err.syscall !== 'setvol'){
            _connection(false);
            adapter.log.error("MPD Error " + JSON.stringify(err));
        }
    });

    client.on('end', function(name) {
        clearTimeout(timer);
        adapter.log.debug("MPD CONNECTION CLOSED", name);
        statePlay.sayid = null;
        _connection(false);
        timer = setTimeout(function (){
            main();
        }, 5000);
    });

    adapter.subscribeStates('*');
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
    var cnt = 0;
    if (arr){
        arr.forEach(function(status){
            client.sendCommand(cmd(status, []), function (err, res){
                if (err) throw err;
                var obj = mpd.parseKeyValueMessage(res);
                //adapter.log.debug('GetStatus - ' + JSON.stringify(obj));
                if (status === 'playlist'){
                    states['playlist_list'] = JSON.stringify(convPlaylist(obj));
                } else {
                    for (var key in obj) {
                        if (obj.hasOwnProperty(key)){
                            var ids = key.toLowerCase();
                            states[ids] = obj[key];
                        }
                    }
                }
                cnt++;
                if(cnt === arr.length) {
                    _shift();
                }
            });
        });
    }
}

function convPlaylist(obj){
    var count = 0;
    playlist = [];
    if (obj && typeof obj === "object"){
        for (var key in obj) {
            if (obj.hasOwnProperty(key)){
                playlist[count] = {
                    "artist":  "",
                    "album":   "",
                    "bitrate": 0,
                    "title":   "",
                    "file":    obj[key],
                    "genre":   "",
                    "year":    0,
                    "len":     "00:00",
                    "rating":  "",
                    "cover":   ""
                };
                count++;
            }
        }
    }
    return playlist;
}
function _shift(){
    var progress;
    if (states.songid !== statePlay.songid){
        statePlay.songid = states.songid;
        clearTag();
    }
    if (states.time){
        var prs = states.time.split(":");
        if(prs[0] && prs[1]){
            statePlay.curtime = parseInt(prs[0], 10);
            statePlay.fulltime = parseInt(prs[1], 10);
            progress = parseFloat((statePlay.curtime * 100) / (statePlay.fulltime || 1)).toFixed(2);
            states['current_duration_s'] = statePlay.fulltime;
            states['current_duration'] = SecToText(statePlay.fulltime);
            states['current_elapsed'] = SecToText(statePlay.curtime);
            states['seek'] = progress || 0;
        }
    }

    statePlay.volume = states.volume;
    states['repeat'] = toBool(states['repeat']);
    states['random'] = toBool(states['random']);

    if (states.state === 'stop' || states.state === 'pause'){
        statePlay.isPlay = false;
        statePlay.sayid = null;
        if (states.state === 'stop'){
            clearTag();
        }
    } else if (states.state === 'play'){
        statePlay.isPlay = true;
        if (states.file && ~states.file.indexOf('/sayit')){
            statePlay.sayid = states.songid;
        } else {
            statePlay.sayid = null;
        }
    }
        SetObj();
}
function SecToText(sec){
    var res;
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    var h = Math.floor(m / 60);
    m = m % 60;
    if (h > 0){
        res = pad2(h) + ":" + pad2(m) + ":" + pad2(s);
    } else {
        res = pad2(m) + ":" + pad2(s);
    }
    return res;
}
function pad2(num) {
    var s = num.toString();
    return (s.length < 2)? "0" + s : s;
}
function toBool(val){
    if(val === 1 || val === '1' || val === true || val === 'true' || val === 'on'){
        val = true;
    } else {
        val = false;
    }
    return val;
}
function SetObj(ob){
    if (ob && ob === 'lsinfo'){
        adapter.setState(ob, {val: states[ob], ack: true});
        old_states['lsinfo'] = states['lsinfo'];
    } else {
        for (var key in states) {
            if (states.hasOwnProperty(key)){
                if (!old_states.hasOwnProperty(key)){
                    old_states[key] = '';
                }
                if (states[key] !== old_states[key]){
                    adapter.setState(key, {val: states[key], ack: true});
                    old_states[key] = states[key];
                }
            }
        }
    }
    GetTime();
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
    var tag = ['error', 'performer', 'album', 'artist', 'composer', 'date', 'disc', 'genre', 'track', 'id', 'title', 'name', 'albumartist'];
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
    if (val === true || val === 'true'){
        statePlay.mute_vol = parseInt(statePlay.volume, 10);
        val = [0];
    } else if (val === false || val === 'false'){
        var vol = statePlay.mute_vol;
        val = [vol];
    }
    return val;
}


var StopTimeOut;
var timer_sayit;
var queue = [];
var isBuf = false;
var option = {
    say: {link: '', vol:  null,  id:   null  },
    cur: {isPlay: false}
};
function sayit(command, val, t){
    clearTimeout(timer_sayit);
    if (!t){
        queue.push(val);
        isBuf = true;
    }
    if (!statePlay.sayid){
        if (queue.length > 0){
            val = queue.shift();
        }
        if (queue.length === 0){
            isBuf = false;
        }
        option.say = {
            link: '', vol:  null,  id:   null
        };
        var p = val.indexOf(';');
        if (p !== -1) {
            option.say.vol = parseInt(val.substring(0, p), 10);
            option.say.link = val.substring(p + 1);
        } else {
            option.say.link = val;
        }
        if (statePlay.isPlay && !statePlay.sayid && !t){
            option.cur = {
                vol:   parseInt(states.volume, 10),
                track: states.pos,
                seek:  statePlay.curtime,
                isPlay: true
            };
        }
        clearTimeout(StopTimeOut);
        if (!t){
            SmoothVol(false, option, function (){
                DelPlaylist(function (){
                    SavePlaylist(function (){
                        ClearPlaylist(function (){
                            SetConsume (1, function (){
                                PlaySay(option);
                            });
                        });
                    });
                });
            });
        } else {
            ClearPlaylist(function (){
                SetConsume (1, function (){
                    PlaySay(option);
                });
            });
        }
    }
}
var SmoothVolTimer;
function SmoothVol(line, option, cb){
    var flag = false;
    var vol;
    if (option.cur && option.cur.vol){
        vol = option.cur.vol;
    }
    clearInterval(SmoothVolTimer);
    if (line){
        vol = 0;
    }
    if (option.cur.isPlay && vol){
        SmoothVolTimer = setInterval(function() {
            Sendcmd('setvol', [vol], function (msg, err){
                if (!err){
                    if (!line){
                        vol = vol - 10;
                        if (vol <= 1){
                            clearInterval(SmoothVolTimer);
                            if(cb) cb();
                        }
                    } else {
                         vol = vol + 10;
                        if (vol >= option.cur.vol && !flag) {
                            vol = option.cur.vol;
                            flag = true;
                        }
                        if (vol >= option.cur.vol && flag){
                            clearInterval(SmoothVolTimer);
                            flag = false;
                            if(cb) cb();
                        }
                    }
                } else {
                    clearInterval(SmoothVolTimer);
                    if(cb) cb();
                }
            });
    }, 250);
    } else {
        if(cb) cb();
    }
}

function PlaySay(option){
    AddPlaylist(option, function (option){
        Sendcmd('playid', [option.say.id], function (msg){
            //GetStatus(["currentsong", "status"]);
            if (option.say.vol){
                setVol(option.say.vol, function (){
                    sayTimePlay(option);
                });
            } else {
                sayTimePlay(option);
            }
        });
    });
}

var sayTimer;
var sayTimeOut;
function sayTimePlay(option){
    clearInterval(sayTimer);
    clearTimeout(sayTimeOut);
    sayTimer = setInterval(function() {
        adapter.log.debug('sayTimePlay...');
        if (!statePlay.isPlay){
            clearInterval(sayTimer);
            clearTimeout(sayTimeOut);
            sayTimer = false;
            StopSay(option);
        }
    }, 100);
    sayTimeOut = setTimeout(function() {
        if (sayTimer){
            clearInterval(sayTimer);
            clearTimeout(sayTimeOut);
            sayTimer = false;
            StopSay(option);
        }
    }, 10000);
}

function StopSay(option){
    clearTimeout(StopTimeOut);
    adapter.log.debug('StopSay...' + JSON.stringify(option));
    if (!isBuf || queue.length === 0){
        SetConsume (0, function (){
            ClearPlaylist(function (){
                LoadPlaylist(function (){
                    StopTimeOut = setTimeout(function (){
                        statePlay.sayid = null;
                        if (option.cur.isPlay){
                            adapter.log.debug('Sayit... Начинаем воспроизведение предыдущего трека');
                            Sendcmd('seek', [option.cur.track, option.cur.seek], function (msg, err){
                                if (!err){
                                    setVol(option.cur.vol, function (){
                                        option = {};
                                    });
                                } else {
                                    Sendcmd('play', [0], function (msg, err){
                                        setVol(option.cur.vol, function (){
                                            option = {};
                                        });
                                    }); 
                                }
                            });
                        } else {
                            adapter.log.debug('Sayit... Загружаем плейлист без воспроизведения');
                            Sendcmd('stop', [], function (msg, err){
                                option = {};
                            });
                        }
                    }, 5000);
                });
            });
        });
    } else {
        StopTimeOut = setTimeout(function (){
            ClearPlaylist(function (){
                statePlay.sayid = null;
                if (queue.length > 0){
                    sayit('', queue, true);
                } else {
                    SetConsume (0, function (){
                        option = {};
                    });
                }
            });
        }, 1000);
    }
}

var setVolTimer;
var setTimeOut;
function setVol(v, cb){
    clearInterval(setVolTimer);
    clearTimeout(setTimeOut);
    var vol = parseInt(v, 10);
    setVolTimer = setInterval(function() {
        //adapter.log.debug('setVol...');
        if (statePlay.isPlay){
            Sendcmd('setvol', [vol], function (msg, err){
                if (!err){
                    clearInterval(setVolTimer);
                    setVolTimer = false;
                    clearTimeout(setTimeOut);
                    if(cb) cb();
                }
            });
        }
    }, 100);
    setTimeOut = setTimeout(function() {
        if (setVolTimer){
            clearInterval(setVolTimer);
            setVolTimer = false;
            if(cb) cb();
        }
    }, 30000);
}

function LoadPlaylist(cb){
    Sendcmd('load', ['temp_ForSayIt'], function(msg){
        adapter.log.debug('LoadPlaylist...' + msg);
        if(cb) cb();
    });
}
function AddPlaylist(option, cb){
    Sendcmd('addid', [option.say.link], function(msg){
        adapter.log.debug('SayIt addid...' + msg);
        msg = mpd.parseKeyValueMessage(msg);
        if (msg.Id && msg.Id !== 'undefined'){
            option.say.id = msg.Id;
            statePlay.sayid = option.say.id;
            if(cb) cb(option);
        }
    });
}
function SetConsume (val, cb){
    Sendcmd('consume ', [val], function(msg){
        adapter.log.debug('CleraPlaylist...' + msg);
        if(cb) cb();
    });
}

function ClearPlaylist(cb){
    Sendcmd('clear', [], function(msg){
        adapter.log.debug('CleraPlaylist...' + msg);
        if(cb) cb();
    });
}
function DelPlaylist(cb){
    Sendcmd('rm', ['temp_ForSayIt'], function(msg){
        adapter.log.debug('DelPlaylist...' + msg);
        if(cb) cb();
    });
}
function SavePlaylist(cb){
    Sendcmd('save', ['temp_ForSayIt'], function(msg){
        adapter.log.debug('SavePlaylist...' + msg);
        if(cb) cb();
    });
}
function filemanager(val, msg){
    var browser = {};
    var files = [];
    var arr = mpd.parseArrayMessage(msg);
    arr.forEach(function(item, i, arr) {
        if (arr[i].hasOwnProperty('directory')){
            var obj = {};
            obj.file = arr[i].directory;
            obj.filetype = 'directory';
            files.push(obj);
        } else if(arr[i].hasOwnProperty('file')){
            var obj = {};
            obj.file = arr[i].file;
            obj.filetype = 'file';
            obj.title = arr[i].Title;
            obj.lastmodified = arr[i]['Last-Modified'].replace('T', ' ').replace('Z', '');
            obj.time = arr[i].Time;
            obj.track = arr[i].Track;
            obj.date = arr[i].Date;
            obj.artist = arr[i].Artist;
            obj.album = arr[i].Album;
            obj.genre = arr[i].Genre;
            files.push(obj);
        }
        if (i === arr.length-1){
            browser.files = files;
            states.lsinfo = JSON.stringify(browser);
            //adapter.log.debug('--------' + JSON.stringify(browser));
            SetObj('lsinfo');
        }
    });
}