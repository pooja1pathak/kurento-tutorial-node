/*
 * (C) Copyright 2014-2015 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
var path = require('path');
var url = require('url');
var cookieParser = require('cookie-parser')
var express = require('express');
var session = require('express-session')
var minimist = require('minimist');
var ws = require('ws');
var kurento = require('kurento-client');
var fs = require('fs');
var https = require('https');
var dateFormat = require('dateformat');
var sleep = require('system-sleep');
var pipeline;
var pipeline1;

var argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'https://localhost:8080/',
        ws_uri: 'ws://localhost:8888/kurento',
        file_uri: 'file:///tmp/test-pooja-hello-world-recording.webm',
        address_uri: 'rtsp://180.179.214.151:8051/test1.sdp',
        //address_uri: 'rtsp://172.30.72.127:8051/test1.sdp',
    }
});

var options = {
    key: fs.readFileSync('keys/server.key'),
    cert: fs.readFileSync('keys/server.crt')
};

var app = express();

/*
 * Management of sessions
 */
app.use(cookieParser());

var sessionHandler = session({
    secret: 'none',
    rolling: true,
    resave: true,
    saveUninitialized: true
});

app.use(sessionHandler);

/*
 * Definition of global variables.
 */
var sessions = {};
var candidatesQueue = {};
var kurentoClient = null;

/*
 * Server startup
 */
var asUrl = url.parse(argv.as_uri);
var port = asUrl.port;
var server = https.createServer(options, app).listen(port, function() {
    console.log('Kurento client started');
    console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

var wss = new ws.Server({
    server: server,
    path: '/kurento'
});

startRec(function(error) {
    if (error) {
        console.log('Recording error');
    };
});

/*
 * Management of WebSocket messages
 */
wss.on('connection', function(ws) {
    var sessionId = null;
    var request = ws.upgradeReq;
    var response = {
        writeHead: {}
    };

    sessionHandler(request, response, function(err) {
        sessionId = request.session.id;
        console.log('Connection received with sessionId ' + sessionId);
    });

    ws.on('error', function(error) {
        console.log('Connection ' + sessionId + ' error');
        stop(sessionId);
    });

    ws.on('close', function() {
        console.log('Connection ' + sessionId + ' closed');
        stop(sessionId);
    });

    ws.on('message', function(_message) {
        var message = JSON.parse(_message);
        console.log('Connection ' + sessionId + ' received message ', message);

        switch (message.id) {
            case 'start':
                sessionId = request.session.id;
                start(sessionId, ws, message.sdpOffer, function(error, sdpAnswer) {
                    if (error) {
                        return ws.send(JSON.stringify({
                            id: 'error',
                            message: error
                        }));
                    }
                    ws.send(JSON.stringify({
                        id: 'startResponse',
                        sdpAnswer: sdpAnswer
                    }));
                });
                break;

            case 'play':
                sessionId = request.session.id;
                console.log("In case play date : " + message.dateTime)
                play(sessionId, ws, message.sdpOffer, message.dateTime, function(error, sdpAnswer) {
                    if (error) {
                        return ws.send(JSON.stringify({
                            id: 'error',
                            message: error
                        }));
                    }
                    ws.send(JSON.stringify({
                        id: 'playResponse',
                        sdpAnswer: sdpAnswer
                    }));
                });
                break;

            case 'stop':
                stop(sessionId);
                break;

            case 'onIceCandidate':
                onIceCandidate(sessionId, message.candidate);
                break;

            default:
                ws.send(JSON.stringify({
                    id: 'error',
                    message: 'Invalid message ' + message
                }));
                break;
        }

    });
});

/*
 * Definition of functions
 */

// Recover kurentoClient for the first time.
function getKurentoClient(callback) {
    if (kurentoClient !== null) {
        return callback(null, kurentoClient);
    }

    kurento(argv.ws_uri, function(error, _kurentoClient) {
        if (error) {
            console.log("Could not find media server at address " + argv.ws_uri);
            return callback("Could not find media server at address" + argv.ws_uri +
                ". Exiting with error " + error);
        }

        kurentoClient = _kurentoClient;
        callback(null, kurentoClient);
    });
}

function startRec(callback) {
    getKurentoClient(function(error, kurentoClient) {
        if (error) {
            return callback(error);
        }
        kurentoClient.create('MediaPipeline', function(error, p) {
            if (error) {
                return callback(error);
            }
            pipeline1 = p

            pipeline1.create("PlayerEndpoint", {
                uri: argv.address_uri
            }, function(error, player) {
                if (error) return onError(error);

                var now = new Date();

                createRecorderElements(pipeline1, now, ws, function(error, RecorderEndpoint) {
                    if (error) {
                        pipeline1.release();
                        return callback(error);
                    }
                    player.connect(RecorderEndpoint, function(error) {
                        if (error) return onError(error);
                        console.log("PlayerEndpoint-->RecorderEndpoint connection established")

                        player.play(function(error) {
                            if (error) return onError(error);
                            console.log("Player playing ...");

                            RecorderEndpoint.record(function(error) {
                                if (error) return onError(error);
                                console.log("Record");
                                while (true) {
                                    var newTime = new Date();
                                    var hour = newTime.getHours();
                                    var minute = newTime.getMinutes();
                                    var second = newTime.getSeconds();

                                    if (hour == 23) {
                                        if (minute == 59) {
                                            if (second == 59) {
                                                sleep(1000);
                                                pipeline1.release();
                                                startRec();
                                            }
                                        }
                                    }
                                    sleep(1000);
                                }
                            });
                        });
                    });
                });
            });
        });
    });
}

function start(sessionId, ws, sdpOffer, callback) {
    if (!sessionId) {
        return callback('Cannot use undefined sessionId');
    }

    getKurentoClient(function(error, kurentoClient) {
        if (error) {
            return callback(error);
        }

        kurentoClient.create('MediaPipeline', function(error, p) {
            if (error) {
                return callback(error);
            }
            pipeline = p

            pipeline.create("PlayerEndpoint", {
                uri: argv.address_uri
            }, function(error, player) {
                if (error) return onError(error);

                createMediaElements(pipeline, ws, function(error, webRtcEndpoint) {
                    if (error) {
                        pipeline.release();
                        return callback(error);
                    }

                    connectMediaElements(webRtcEndpoint, function(error) {
                        if (error) {
                            pipeline.release();
                            return callback(error);
                        }

                        webRtcEndpoint.on('OnIceCandidate', function(event) {
                            var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                            ws.send(JSON.stringify({
                                id: 'iceCandidate',
                                candidate: candidate
                            }));
                        });

                        webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
                            if (error) {
                                pipeline.release();
                                return callback(error);
                            }

                            sessions[sessionId] = {
                                'pipeline': pipeline,
                                'webRtcEndpoint': webRtcEndpoint
                            }
                            return callback(null, sdpAnswer);
                        });

                        webRtcEndpoint.gatherCandidates(function(error) {
                            if (error) {
                                return callback(error);
                            }
                        });

                        player.connect(webRtcEndpoint, function(error) {
                            if (error) return onError(error);

                            console.log("PlayerEndpoint-->WebRtcEndpoint connection established");

                            player.play(function(error) {
                                if (error) return onError(error);
                                console.log("Player playing ...");
                            });
                        });
                    });
                });
            });
        });
    });
}

function play(sessionId, ws, sdpOffer, date, callback) {

    console.log("In method play")
    console.log("date: "+ date)
    if (!sessionId) {
        return callback('Cannot use undefined sessionId');
    }

    getKurentoClient(function(error, kurentoClient) {
        if (error) {
            return callback(error);
        }


        kurentoClient.create('MediaPipeline', function(error, p) {
            if (error) {
                return callback(error);
            }

            pipeline = p

            var dateConverted = new Date(date);

            var dateFormated =  dateFormat(dateConverted, "ddmmyyyy");

            pipeline.create('PlayerEndpoint', {
                uri: 'file:///tmp/' + dateFormated + '/kurento-recording.webm',
                useEncodedMedia: false
            }, function(error, playerEndpoint) {

                playerEndpoint.on('EndOfStream', function() {
                    pipeline.release();
                });
                
                console.log('file:///tmp/' + dateFormat(date, "ddmmyyyy") + '/kurento-recording.webm')

                playerEndpoint.play(function(error) {
                    if (error) return wsError(ws, "ERROR 4: " + error);

                    pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
                        if (error) {
                            pipeline.release();
                            return callback(error);
                        }

                        if (candidatesQueue[sessionId]) {
                            while (candidatesQueue[sessionId].length) {
                                var candidate = candidatesQueue[sessionId].shift();
                                webRtcEndpoint.addIceCandidate(candidate);
                            }
                        }

                        playerEndpoint.connect(webRtcEndpoint, function(error) {
                            if (error) {
                                pipeline.release();
                                return callback(error);
                            }

                            webRtcEndpoint.on('OnIceCandidate', function(event) {
                                var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                                ws.send(JSON.stringify({
                                    id: 'iceCandidate',
                                    candidate: candidate
                                }));
                            });

                            webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
                                if (error) {
                                    pipeline.release();
                                    return callback(error);
                                }
                                sessions[sessionId] = {
                                    'pipeline': pipeline,
                                    'webRtcEndpoint': webRtcEndpoint,
                                    'playerEndpoint': playerEndpoint
                                }
                                return callback(null, sdpAnswer);
                            });

                            webRtcEndpoint.gatherCandidates(function(error) {
                                if (error) {
                                    return callback(error);
                                }
                            });
                        });
                    });
                });
            });
        });
    });
}

function createMediaElements(pipeline, ws, callback) {
    pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
        if (error) {
            return callback(error);
        }

        return callback(null, webRtcEndpoint);
    });
}

function createRecorderElements(pipeline, now, ws, callback) {
    pipeline.create('RecorderEndpoint', {
        stopOnEndOfStream: true,
        mediaProfile: 'WEBM_VIDEO_ONLY',
        uri: 'file:///tmp/' + dateFormat(now, "ddmmyyyy") + '/kurento-recording.webm'
    }, function(error, RecorderEndpoint) {
        if (error) {
            return callback(error);
        }

        return callback(null, RecorderEndpoint);
    });
}

function connectMediaElements(webRtcEndpoint, callback) {
    webRtcEndpoint.connect(webRtcEndpoint, function(error) {
        if (error) {
            return callback(error);
        }
        return callback(null);
    });
}

function stop(sessionId) {
    if (sessions[sessionId]) {
        var pipeline = sessions[sessionId].pipeline;
        console.info('Releasing pipeline');
        pipeline.release();

        delete sessions[sessionId];
        delete candidatesQueue[sessionId];
    }
}

function onIceCandidate(sessionId, _candidate) {
    var candidate = kurento.getComplexType('IceCandidate')(_candidate);

    if (sessions[sessionId]) {
        console.info('Sending candidate');
        var webRtcEndpoint = sessions[sessionId].webRtcEndpoint;
        webRtcEndpoint.addIceCandidate(candidate);
    } else {
        console.info('Queueing candidate');
        if (!candidatesQueue[sessionId]) {
            candidatesQueue[sessionId] = [];
        }
        candidatesQueue[sessionId].push(candidate);
    }
}

process.on('SIGINT', function() {
  //socket.close();
  console.log("In exit");
  if(pipeline1){
    pipeline1.release();
    pipeline1 = null;
    console.log("Pipeline1 released");
  }
  server.stop( function() {
        console.log( "stopped" );
        //process.exit( 0 );
        //process.exit( 0 );
    } );
    process.exit( 0 );
  //server.close( function() {
        //console.log( "closed" );
        //process.exit( 0 );
    //} );
  //pipeline1.release();
  
  //process.exit(0);
});


app.use(express.static(path.join(__dirname, 'static')));
