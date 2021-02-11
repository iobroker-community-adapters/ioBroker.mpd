"use strict";
const utils = require('@iobroker/adapter-core');
const mpd = require('mpd'), cmd = mpd.cmd;

let adapter, playlist = [], connection = false, states = {}, old_states = {}, client, timer, int, StopTimeOut, sayTimer, sayTimeOut, SmoothVolTimer, timer_sayit, queue = [],
    isBuf = false, setVolTimer, setTimeOut;

let statePlay = {
    'fulltime': 0,
    'curtime':  0,
    'Id':       0,
    'isPlay':   false,
    'iSsay':    false,
    'sayid':    null,
    'volume':   0,
    'mute_vol': 30,
    'songid':   null
};

let options_ = {
    say: {link: '', vol: null, id: null},
    cur: {isPlay: false}
};

function startAdapter(options){
    return adapter = utils.adapter(Object.assign({}, options, {
        systemConfig: true,
        name:         'mpd',
        ready:        main,
        unload:       callback => {
            try {
                timer && clearTimeout(timer);
                int && clearTimeout(int);
                timer_sayit && clearTimeout(timer_sayit);
                StopTimeOut && clearTimeout(StopTimeOut);
                SmoothVolTimer && clearInterval(SmoothVolTimer);
                sayTimer && clearInterval(sayTimer);
                sayTimeOut && clearTimeout(sayTimeOut);
                setTimeOut && clearTimeout(setTimeOut);
                setVolTimer && clearInterval(setVolTimer);
                adapter.log.debug('cleaned everything up...');
                callback();
            } catch (e) {
                callback();
            }
        },
        stateChange:  (id, state) => {
            if (connection){
                if (id && state && !state.ack){
                    adapter.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
                    let ids = id.split(".");
                    let command = ids[ids.length - 1].toString();
                    let val = [state.val];
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
                            val[0] = parseInt(val[0], 10);
                            let full = statePlay.fulltime;
                            val = [parseInt((full / 100) * val[0], 10)];
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
                        if (val){
                            sayit(command, val);
                        }
                    } else if (command === 'addplay'){
                        addplay('addid', val);
                    } else {
                        client.sendCommand(cmd(command, val), (err, msg) => {
                            if (err){
                                adapter.log.error('client.sendCommand {"' + command + '": "' + val + '"} ERROR - ' + err);
                            } else {
                                if (command !== 'setvol'){
                                    adapter.log.debug('client.sendCommand {"' + command + '": "' + val + '"} OK!');
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
        },
        message:      (obj) => {
            if (typeof obj === 'object' && obj.command){
                adapter.log.debug(`message ******* ${JSON.stringify(obj)}`);
                if (obj.command === 'say'){
                    if (obj.message) sayit('say', obj.message);
                }
            } else {
                adapter.log.debug(`message x ${obj.command}`);
            }
        }
    }));
}

function Sendcmd(command, val, callback){
    client.sendCommand(cmd(command, val), (err, msg) => {
        if (err){
            if (command !== 'setvol'){
                adapter.log.error('client.sendCommand {"' + command + '": "' + val + '"} ERROR - ' + err);
            }
            if (callback){
                callback(msg, err);
            } else {
                return;
            }
        } else {
            adapter.log.debug('client.sendCommand {"' + command + '": "' + val + '"} OK! - ' + JSON.stringify(msg));
            callback(msg);
        }
    });
}

function main(){
    statePlay.isPlay = false;
    client = mpd.connect({
        host:     adapter.config.ip || '127.0.0.1',
        port:     adapter.config.port || 6600,
        password: adapter.config.password || ''
    });
    client.on('ready', () => {
        _connection(true);
        GetStatus(['status', 'playlist', 'listplaylists']);
    });

    client.on('system', (name) => {
        //adapter.log.debug("update system - " + JSON.stringify(name));
        switch (name) {
            case 'playlist':
                GetStatus(["playlist"]);
                break;
            case 'stored_playlist':
                GetStatus(["listplaylists"]);
                break;
            default:
                if (name !== 'mixer' && !statePlay.iSsay){
                    GetStatus(["currentsong", "status", "stats"]);
                }
        }
    });

    client.on('error', (err) => {
        if (err.syscall !== 'connect' && err.code !== 'ETIMEDOUT' && err.code !== 'ENOTFOUND' && err.syscall !== 'setvol'){
            _connection(false);
            adapter.log.error("MPD Error " + JSON.stringify(err));
        }
    });

    client.on('end', (name) => {
        timer && clearTimeout(timer);
        adapter.log.debug("MPD CONNECTION CLOSED", name);
        statePlay.sayid = null;
        _connection(false);
        timer = setTimeout(() => {
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

function GetStatus(arr, cb){
    let cnt = 0;
    if (arr){
        arr.forEach((status) => {
            client.sendCommand(cmd(status, []), (err, res) => {
                if (err) throw err;
                let obj = mpd.parseKeyValueMessage(res);
                //adapter.log.debug('GetStatus - ' + JSON.stringify(obj));
                if (status === 'listplaylists'){
                    obj = mpd.parseArrayMessage(res);
                    states['listplaylists'] = JSON.stringify(convStoredPlaylists(obj));
                } else if (status === 'playlist'){
                    states['playlist_list'] = JSON.stringify(convPlaylist(obj));
                } else {
                    for (let key in obj) {
                        if (obj.hasOwnProperty(key)){
                            let ids = key.toLowerCase();
                            states[ids] = obj[key];
                        }
                    }
                }
                cnt++;
                if (cnt === arr.length){
                    if (cb){
                        cb(states);
                    } else {
                        _shift();
                    }
                }
            });
        });
    }
}

function convStoredPlaylists(obj){
    let playlists = [];
    if (obj && obj instanceof Array){
        let val;
        for (val of obj) {
            playlists.push(val["playlist"]);
        }
    }
    return playlists;
}

function convPlaylist(obj){
    let count = 0;
    playlist = [];
    if (obj && typeof obj === "object"){
        for (let key in obj) {
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
    let progress;
    if (states.songid !== statePlay.songid){
        statePlay.songid = states.songid;
        clearTag();
    }
    if (states.time){
        let prs = states.time.split(":");
        if (prs[0] && prs[1]){
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

    adapter.log.debug('PLAY STATUS - ' + states.state);

    if (states.state === 'stop'){
        clearTag();
    }
    if (states.state === 'stop' || states.state === 'pause'){
        statePlay.isPlay = false;
    } else if (states.state === 'play'){
        statePlay.isPlay = true;
    }
    SetObj();
}

function isPlay(objs){
    if (objs.state === 'stop' || objs.state === 'pause'){
        statePlay.isPlay = false;
        statePlay.sayid = null;
    } else if (objs.state === 'play'){
        statePlay.isPlay = true;
        if (objs.file && ~objs.file.indexOf('/sayit')){
            statePlay.sayid = objs.songid;
            statePlay.isPlay = false;
        } else {
            statePlay.sayid = null;
        }
    }
    return statePlay;
}

function SecToText(sec){
    let res;
    let m = Math.floor(sec / 60);
    let s = sec % 60;
    let h = Math.floor(m / 60);
    m = m % 60;
    if (h > 0){
        res = pad2(h) + ":" + pad2(m) + ":" + pad2(s);
    } else {
        res = pad2(m) + ":" + pad2(s);
    }
    return res;
}

function pad2(num){
    let s = num.toString();
    return (s.length < 2) ? "0" + s :s;
}

function toBool(val){
    val = val === 1 || val === '1' || val === true || val === 'true' || val === 'on';
    return val;
}

function SetObj(id){
    if (id && id === 'lsinfo'){
        adapter.setState(id, {val: states[id], ack: true});
        old_states['lsinfo'] = states['lsinfo'];
    } else {
        for (let key in states) {
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
    int && clearTimeout(int);
    if (statePlay.isPlay){
        int = setTimeout(() => {
            //statePlay.isPlay = false;
            GetStatus(["currentsong", "status"]);
        }, 1000);
    }
}

function clearTag(){
    let tag = ['error', 'performer', 'album', 'artist', 'composer', 'date', 'disc', 'genre', 'track', 'id', 'title', 'name', 'albumartist'];
    tag.forEach((name) => {
        states[name] = '';
    });
}

function addplay(command, val){
    command = 'addid';
    Sendcmd(command, val, (msg) => {
        msg = mpd.parseKeyValueMessage(msg);
        if (msg.Id){
            command = 'playid';
            val = [msg.Id];
            Sendcmd(command, val, (msg) => {
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
        let vol = statePlay.mute_vol;
        val = [vol];
    }
    return val;
}

function sayit(command, val, t){
    adapter.log.debug('sayit options_..........' + JSON.stringify(options_));
    timer_sayit && clearTimeout(timer_sayit);
    if (!t){
        queue.push(val);
        isBuf = true;
    }
    GetStatus(["status", "currentsong"], (st) => {
        statePlay = isPlay(st);
        if (!statePlay.sayid){
            if (queue.length > 0){
                val = queue.shift();
            }
            if (queue.length === 0){
                isBuf = false;
            }
            options_.say = {
                link: '', vol: null, id: null
            };
            let p = val.indexOf(';');
            if (p !== -1){
                options_.say.vol = parseInt(val.substring(0, p), 10);
                options_.say.link = val.substring(p + 1);
            } else {
                options_.say.link = val;
            }
            adapter.log.debug('statePlay = ' + JSON.stringify(statePlay));
            if (statePlay.isPlay && !statePlay.sayid && !t){
                options_.cur = {
                    vol:    parseInt(states.volume, 10),
                    track:  states.pos,
                    seek:   statePlay.curtime,
                    isPlay: true
                };
            } else if (!statePlay.isPlay && !statePlay.sayid && !t){
                options_.cur = {isPlay: false};
            }
            adapter.log.debug('sayit2 statePlay..........' + JSON.stringify(statePlay));
            adapter.log.debug('sayit2 options_..........' + JSON.stringify(options_));
            StopTimeOut && clearTimeout(StopTimeOut);
            if (!t){
                SmoothVol(false, options_, () => {
                    DelPlaylist(() => {
                        SavePlaylist(() => {
                            ClearPlaylist(() => {
                                SetConsume(1, () => {
                                    PlaySay(options_);
                                });
                            });
                        });
                    });
                });
            } else {
                ClearPlaylist(() => {
                    SetConsume(1, () => {
                        PlaySay(options_);
                    });
                });
            }
        }
    });
}

function SmoothVol(line, options_, cb){
    let flag = false;
    let vol;
    if (options_.cur && options_.cur.vol){
        vol = options_.cur.vol;
    }
    SmoothVolTimer && clearInterval(SmoothVolTimer);
    if (line){
        vol = 0;
    }
    adapter.log.debug('SmoothVol options_.cur.isPlay - ' + options_.cur.isPlay);
    if (options_.cur.isPlay && vol){
        SmoothVolTimer = setInterval(() => {
            Sendcmd('setvol', [vol], (msg, err) => {
                if (!err){
                    if (!line){
                        vol = vol - 10;
                        if (vol <= 1){
                            clearInterval(SmoothVolTimer);
                            cb && cb();
                        }
                    } else {
                        vol = vol + 10;
                        if (vol >= options_.cur.vol && !flag){
                            vol = options_.cur.vol;
                            flag = true;
                        }
                        if (vol >= options_.cur.vol && flag){
                            clearInterval(SmoothVolTimer);
                            flag = false;
                            cb && cb();
                        }
                    }
                } else {
                    SmoothVolTimer && clearInterval(SmoothVolTimer);
                    cb && cb();
                }
            });
        }, 250);
    } else {
        cb && cb();
    }
}

function PlaySay(option){
    AddPlaylist(option, (option) => {
        Sendcmd('playid', [option.say.id], (msg) => {
            //GetStatus(["currentsong", "status"]);
            if (option.say.vol){
                setVol(option.say.vol, () => {
                    sayTimePlay(option);
                });
            } else {
                sayTimePlay(option);
            }
        });
    });
}

function sayTimePlay(option){
    sayTimer && clearInterval(sayTimer);
    sayTimeOut && clearTimeout(sayTimeOut);
    sayTimer = setInterval(() => {
        adapter.log.debug('sayTimePlay...');
        if (!statePlay.isPlay){
            sayTimer && clearInterval(sayTimer);
            sayTimeOut && clearTimeout(sayTimeOut);
            sayTimer = false;
            StopSay(option);
        }
    }, 100);
    sayTimeOut = setTimeout(() => {
        if (sayTimer){
            sayTimer && clearInterval(sayTimer);
            sayTimeOut && clearTimeout(sayTimeOut);
            sayTimer = false;
            StopSay(option);
        }
    }, 60000);
}

function StopSay(option){
    StopTimeOut && clearTimeout(StopTimeOut);
    adapter.log.debug('StopSay options_..........' + JSON.stringify(option));
    if (!isBuf || queue.length === 0){
        SetConsume(0, () => {
            ClearPlaylist(() => {
                LoadPlaylist(() => {
                    StopTimeOut = setTimeout(() => {
                        statePlay.sayid = null;
                        if (option && option.cur.isPlay){
                            adapter.log.debug('Sayit... Начинаем воспроизведение предыдущего трека');
                            Sendcmd('seek', [option.cur.track, option.cur.seek], (msg, err) => {
                                if (!err){
                                    setVol(option.cur.vol, () => {
                                        options_ = {
                                            say: {link: '', vol: null, id: null},
                                            cur: {isPlay: false}
                                        };
                                    });
                                } else {
                                    Sendcmd('play', [0], (msg, err) => {
                                        setVol(option.cur.vol, () => {
                                            options_ = {
                                                say: {link: '', vol: null, id: null},
                                                cur: {isPlay: false}
                                            };
                                        });
                                    });
                                }
                            });
                        } else {
                            adapter.log.debug('Sayit... Загружаем плейлист без воспроизведения');
                            Sendcmd('stop', [], (msg, err) => {
                                options_ = {
                                    say: {link: '', vol: null, id: null},
                                    cur: {isPlay: false}
                                };
                            });
                        }
                    }, 5000);
                });
            });
        });
    } else {
        StopTimeOut = setTimeout(() => {
            ClearPlaylist(() => {
                statePlay.sayid = null;
                if (queue.length > 0){
                    sayit('', queue, true);
                } else {
                    SetConsume(0, () => {
                        option = {};
                    });
                }
            });
        }, 1000);
    }
}

function setVol(v, cb){
    setVolTimer && clearInterval(setVolTimer);
    setTimeOut && clearTimeout(setTimeOut);
    let vol = parseInt(v, 10);
    setVolTimer = setInterval(() => {
        //adapter.log.debug('setVol...');
        //if (statePlay.isPlay){
        Sendcmd('setvol', [vol], (msg, err) => {
            if (!err){
                clearInterval(setVolTimer);
                setVolTimer = false;
                setTimeOut && clearTimeout(setTimeOut);
                cb && cb();
            }
        });
        //}
    }, 100);
    setTimeOut = setTimeout(() => {
        if (setVolTimer){
            setVolTimer && clearInterval(setVolTimer);
            setVolTimer = false;
            cb && cb();
        }
    }, 30000);
}

function LoadPlaylist(cb){
    Sendcmd('load', ['temp_ForSayIt'], (msg) => {
        adapter.log.debug('LoadPlaylist...' + msg);
        cb && cb();
    });
}

function AddPlaylist(option, cb){
    Sendcmd('addid', [option.say.link], (msg) => {
        adapter.log.debug('SayIt addid...' + msg);
        msg = mpd.parseKeyValueMessage(msg);
        if (msg.Id && msg.Id !== 'undefined'){
            option.say.id = msg.Id;
            statePlay.sayid = option.say.id;
            cb && cb(option);
        }
    });
}

function SetConsume(val, cb){
    Sendcmd('consume ', [val], (msg) => {
        adapter.log.debug('SetConsume...' + msg);
        cb && cb();
    });
}

function ClearPlaylist(cb){
    Sendcmd('clear', [], (msg) => {
        adapter.log.debug('ClearPlaylist...' + msg);
        cb && cb();
    });
}

function DelPlaylist(cb){
    Sendcmd('rm', ['temp_ForSayIt'], (msg) => {
        adapter.log.debug('DelPlaylist...' + msg);
        cb && cb();
    });
}

function SavePlaylist(cb){
    Sendcmd('save', ['temp_ForSayIt'], (msg) => {
        adapter.log.debug('SavePlaylist...' + msg);
        cb && cb();
    });
}

function filemanager(val, msg){
    let browser = {};
    let files = [];
    let arr = mpd.parseArrayMessage(msg);
    arr.forEach((item, i, arr) => {
        if (arr[i].hasOwnProperty('directory')){
            let obj = {};
            obj.file = arr[i].directory;
            obj.filetype = 'directory';
            files.push(obj);
        } else if (arr[i].hasOwnProperty('file')){
            let obj = {};
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
        if (i === arr.length - 1){
            browser.files = files;
            states.lsinfo = JSON.stringify(browser);
            //adapter.log.debug('--------' + JSON.stringify(browser));
            SetObj('lsinfo');
        }
    });
}

if (module.parent){
    module.exports = startAdapter;
} else {
    startAdapter();
}
