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

var ws = new WebSocket('wss://' + location.host + '/helloworld');
var videoInput;
var videoOutput;
var webRtcPeer;
var state = null;
var file_uri = 'file:///tmp/test-pooja-hello-world-recording.webm';
var address_uri = 'rtsp://180.179.214.151:8051/test1.sdp';

const I_CAN_START = 0;
const I_CAN_STOP = 1;
const I_AM_STARTING = 2;

window.onload = function() {
        console = new Console();
        console.log('Page loaded ...');
        videoInput = document.getElementById('videoInput');
        videoOutput = document.getElementById('videoOutput');
        setState(I_CAN_START);
}

window.onbeforeunload = function() {
        ws.close();
}

ws.onmessage = function(message) {
        var parsedMessage = JSON.parse(message.data);
        console.info('Received message: ' + message.data);

        switch (parsedMessage.id) {
        case 'startResponse':
                startResponse(parsedMessage);
                break;
        case 'playResponse':
		playResponse(parsedMessage);
		break;
        case 'error':
                if (state == I_AM_STARTING) {
                        setState(I_CAN_START);
                }
                onError('Error message from server: ' + parsedMessage.message);
                break;
        case 'iceCandidate':
                webRtcPeer.addIceCandidate(parsedMessage.candidate)
                break;
        default:
                if (state == I_AM_STARTING) {
                        setState(I_CAN_START);
                }
                onError('Unrecognized message', parsedMessage);
        }
}

function start() {
        console.log('Starting video call ...')

        // Disable start button
        setState(I_AM_STARTING);
        //showSpinner(videoInput, videoOutput);
        showSpinner(videoOutput);

        console.log('Creating WebRtcPeer and generating local sdp offer ...');

    var options = {
      //localVideo: videoInput,
      remoteVideo: videoOutput,
      onicecandidate : onIceCandidate
    }

    //webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options, function(error) {
    webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function(error) {
        if(error) return onError(error);
        this.generateOffer(onOffer);

        webRtcPeer.peerConnection.addEventListener('iceconnectionstatechange', function(event){
          if(webRtcPeer && webRtcPeer.peerConnection){
            console.log("oniceconnectionstatechange -> " + webRtcPeer.peerConnection.iceConnectionState);
            console.log('icegatheringstate -> ' + webRtcPeer.peerConnection.iceGatheringState);
          }
        });
    });
}

var methods = {
	record: function() {
		//console.log('Star Recording ...')
		//console.log('Creating WebRtcPeer and generating local sdp offer ...');
		var options = {
      			//onicecandidate : onIceCandidate
    		}
		webRtcPeer = new kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function(error) {
        		if(error) return onError(error);
        		this.generateOffer(onRecordOffer);
        		//webRtcPeer.peerConnection.addEventListener('iceconnectionstatechange', function(event){
          			//if(webRtcPeer && webRtcPeer.peerConnection){
            				//console.log("oniceconnectionstatechange -> " + webRtcPeer.peerConnection.iceConnectionState);
            				//console.log('icegatheringstate -> ' + webRtcPeer.peerConnection.iceGatheringState);
          			//}
        		//});
    		});
	},
	onRecordOffer: function() {
		if(error) return onError(error);
        getKurentoClient(function(error, kurentoClient) {
        if (error) {
            return callback(error);
        }
        kurentoClient.create('MediaPipeline', function(error, p) {
            if (error) {
               return callback(error);
            }
                 pipeline = p
            pipeline.create("PlayerEndpoint", {uri: address_uri}, function(error, player){
                if(error) return onError(error);
		    
	    pipeline.create("webRtcEndpoint", function(error, webRtcEndpoint){
                if(error) return onError(error);
		    
	    pipeline.create("RecorderEndpoint", {stopOnEndOfStream: true, mediaProfile:'WEBM_VIDEO_ONLY', uri: file_uri}, function(error, RecorderEndpoint){
                if(error) return onError(error);
	    setIceCandidateCallbacks(webRtcPeer, webRtc, onError)
		    
	    webRtcEndpoint.connect(webRtcEndpoint, function(error) {
        	if(error) return onError(error);
            webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
            	if (error) {
                      return callback(error);
                  }
            });
            webRtcEndpoint.gatherCandidates(function(error) {
                  if (error) {
                      return callback(error);
                  }
             });
             player.connect(webRtcEndpoint, function(error){
                   if(error) return onError(error);
                    //console.log("PlayerEndpoint-->WebRtcEndpoint connection established");
                    player.connect(RecorderEndpoint, function(error){
                         if(error) return onError(error);
                         //console.log("PlayerEndpoint-->RecorderEndpoint connection established")
                          RecorderEndpoint.record(function(error){
                                if(error) return onError(error);
                                //console.log("Record");
                          });
		    });
              });
          });
      });
    });
   });
  });
 });
}
};
module.exports = methods;

function play() {
	console.log('Playing recorded video ...')

	// Disable play button
	//setState(I_AM_PLAYING);
	showSpinner(videoOutput);

	console.log('Creating WebRtcPeer and generating local sdp offer ...');

    var options = {
      //localVideo: videoInput,
      remoteVideo: videoOutput,
      onicecandidate : onIceCandidate
    }

    webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function(error) {
        if(error) return onError(error);
        this.generateOffer(onPlayOffer);
    });
}

function onIceCandidate(candidate) {
           console.log('Local candidate' + JSON.stringify(candidate));

           var message = {
              id : 'onIceCandidate',
              candidate : candidate
           };
           sendMessage(message);
}

function onOffer(error, offerSdp) {
        if(error) return onError(error);

        console.info('Invoking SDP offer callback function ' + location.host);
        var message = {
                id : 'start',
                sdpOffer : offerSdp
        }
        sendMessage(message);
}

function onPlayOffer(error, offerSdp) {
	if(error) return onError(error);

	console.info('Invoking SDP offer callback function ' + location.host);
	var message = {
		id : 'play',
		sdpOffer : offerSdp
	}
	sendMessage(message);
}

function onError(error) {
        console.error(error);
}

function startResponse(message) {
        setState(I_CAN_STOP);
        console.log('SDP answer received from server. Processing ...');
        webRtcPeer.processAnswer(message.sdpAnswer);
}

function playResponse(message) {
	setState(I_CAN_STOP);
	console.log('SDP answer received from server. Processing ...');
	webRtcPeer.processAnswer(message.sdpAnswer);
}

function stop() {
        console.log('Stopping video call ...');
        setState(I_CAN_START);
        if (webRtcPeer) {
                webRtcPeer.dispose();
                webRtcPeer = null;

                var message = {
                        id : 'stop'
                }
                sendMessage(message);
        }
        //hideSpinner(videoInput, videoOutput);
        hideSpinner(videoOutput);
}

function setState(nextState) {
        switch (nextState) {
        case I_CAN_START:
                $('#start').attr('disabled', false);
                $('#start').attr('onclick', 'start()');
                $('#stop').attr('disabled', true);
                $('#stop').removeAttr('onclick');
                break;

        case I_CAN_STOP:
                $('#start').attr('disabled', true);
                $('#stop').attr('disabled', false);
                $('#stop').attr('onclick', 'stop()');
                break;

        case I_AM_STARTING:
                $('#start').attr('disabled', true);
                $('#start').removeAttr('onclick');
                $('#stop').attr('disabled', true);
                $('#stop').removeAttr('onclick');
                break;

        default:
                onError('Unknown state ' + nextState);
                return;
        }
        state = nextState;
}

function sendMessage(message) {
        var jsonMessage = JSON.stringify(message);
        console.log('Senging message: ' + jsonMessage);
        ws.send(jsonMessage);
}

function showSpinner() {
        for (var i = 0; i < arguments.length; i++) {
                arguments[i].poster = './img/transparent-1px.png';
                arguments[i].style.background = 'center transparent url("./img/spinner.gif") no-repeat';
        }
}

function hideSpinner() {
        for (var i = 0; i < arguments.length; i++) {
                arguments[i].src = '';
                arguments[i].poster = './img/webrtc.png';
                arguments[i].style.background = '';
        }
}

/**
 * Lightbox utility (to display media pipeline image in a modal dialog)
 */
$(document).delegate('*[data-toggle="lightbox"]', 'click', function(event) {
        event.preventDefault();
        $(this).ekkoLightbox();
});
