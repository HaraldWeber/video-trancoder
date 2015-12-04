#!/usr/bin/env node

var spawn = require('child_process').spawn;
var exec = require('child_process').exec;

var DEBUG = true;

var inputFile = process.argv[2];
var outputFile = process.argv[3];

var inputVideo = {};

var LOG = function(message) {
	if (DEBUG) {
		if(message === typeof 'object') {
			console.dir(message);
		} else {
			console.log(message);
		}	
	}
}

var USAGE = function() {
	console.log('');
	console.log('Usage: ' + process.argv[1] + ' <input> <output>');
	console.log('');
}

var Lang = function() {
    this.langs = arguments;
}

Lang.prototype.isLang = function(lang) {
    for(i in this.langs) {
        if(this.langs[i].toLowerCase() == lang.toLowerCase()) {
            return true;
        }
    }
    return false;
}

/* add language codes from http://www.science.co.il/Language/Codes.asp */
var gerLang = new Lang('de', 'ger', 'deu', 'german', 'deutsch');
var engLang = new Lang('en', 'eng');
// empty or undefined
var emptyLang= new Lang('', 'und');
// sort audio tracks: first german second english
// if no language code is present use at least the first two tracks
var wantedAudioTracks = [gerLang, engLang, emptyLang, emptyLang];

if (typeof(inputFile) === 'undefined' || typeof(outputFile) === 'undefined') {
	USAGE();
	process.exit(0);
}

var parseMediaInfo = function(metadata) {
	var format = metadata.format;
	inputVideo.duration = format.duration;
	inputVideo.size = format.size;

	inputVideo.audio = [];
	inputVideo.subtitle = [];

	for(var i = 0; i < metadata.streams.length; i++) {
		var stream = metadata.streams[i];
		switch(stream.codec_type) {
			case "video": {
				inputVideo.video = parseVideoInfo(stream);
				break;
			}
			case "audio": {
				inputVideo.audio.push(parseAudioInfo(stream));
				break;
			}
			case "subtitle": {
				inputVideo.subtitle.push(parseSubtitleInfo(stream));
				break;
			}
		}
	}
	inputVideo.video.bitrate = estimateVideoBitrate(inputVideo);
	var outputMedia = calcSettings(inputVideo);
	outputMedia.duration = format.duration;
	return outputMedia;
};

var calcSettings = function(inputMedia) {
	var outputMedia = {};
	outputMedia.audio = [];
	outputMedia.subtitle = [];
    var video = inputMedia.video;
    LOG(' *** VIDEO *** ');
    LOG('Stream: ' + video.index);
    LOG('Resolution: ' + video.width + 'x' + video.height);
    LOG('Bitrate: ' + Math.round(video.bitrate/1000) + ' kbit');
	var copy_video = true;
	var videoBitrate = Math.sqrt((inputMedia.video.width * inputMedia.video.width +
							inputMedia.video.height * inputMedia.video.height) * 1.6) * 1000;
	if (inputMedia.video.bitrate < videoBitrate * 1.25) {
		// just copy the video stream
		videoBitrate = 0;
		copy_video = true;
        LOG('Action: copy');
	} else {
		copy_video = false;
        LOG('Action: transcode (' + Math.round(video.bitrate/1000)  + ' kbit -> ' + Math.round(videoBitrate/1000) + ' kbit)');
	}
    LOG('');
	outputMedia.video = {
		"index": 0,
		"source_index": inputMedia.video.index,
		"bit_rate": Math.ceil(videoBitrate),
		"copy_video": copy_video
	};

	// find first german audio stream then first english stream
	var index = 1;

	// sort the audio streams
	inputMedia.audio.sort(function(a1, a2) {
		if (gerLang.isLang(a1.language) && engLang.isLang(a2.language)) {
			return 1;
		} else if (engLang.isLang(a1.language) && gerLang.isLang(a2.language)) {
			return -1;
		} else if (a1.language == a2.language) {
			if (a1.channels >= a2.channels) {
				return 1;
            } else if (a1.channels == a2.channels) {
                if(a1.bit_rate > a2.bit_rate) {
                    return 1;
                } else {
                    return -1;
                }
			} else {
				return -1;
			}
		} else {
			return 0;
		}

	});

    LOG(' *** AUDIO *** ');
	wantedAudioTracks.forEach(function(lang) {
		inputMedia.audio.forEach(function(audio) {
			if (lang.isLang(audio.language)) {
				var bitrate = 64000;
				var copy_audio = false;
                LOG('Stream: ' + audio.index);
                LOG('Lang:' + audio.language);
                LOG('Channels: ' + audio.channels);
                LOG('Bitrate: ' + Math.round(audio.bit_rate/1000) + ' kbit');
				if (audio.bit_rate <= audio.channels * 100000 && audio.bit_rate > 0) {
					bitrate = audio.bit_rate;
					copy_audio = true;
                    LOG('Action: copy');
				} else {
                    LOG('Action: transcode (' + Math.round(audio.bit_rate/1000) + ' kbit -> ' + Math.round(audio.channels) * 64 + ' kbit)');
				}
				outputMedia.audio.push({
					"index": index,
					"source_index": audio.index,
					"bit_rate": bitrate * audio.channels,
					"channels": audio.channels,
					"language": lang,
					"copy_audio": copy_audio
				});
                inputMedia.audio.splice(inputMedia.audio.indexOf(audio), 1);
				index += 1;
                LOG('');
			}
		});
	});

	// add all subtitles
	inputMedia.subtitle.forEach(function(subtitle) {
		outputMedia.subtitle.push({
			"index": index,
			"source_index": subtitle.index,
			"default": subtitle.default,
			"forced": subtitle.forced,
			"language": subtitle.language
		});
		index += 1;
	});
	return outputMedia;
}

var parseVideoInfo = function(videoData) {
	var video = {
		"index": videoData.index,
		"width": videoData.width,
		"height": videoData.height
	}
	return video;
};

var parseAudioInfo = function(audioData) {
	var language = ""; 
	if (typeof audioData.tags !== 'undefined') {
		language = audioData.tags.language || "";
	}
	var audioBitrate = 0;
	if (typeof audioData.bit_rate !== 'undefined') {
		audioBitrate = audioData.bit_rate;
	} else if (typeof audioData.tags !== 'undefined' && typeof audioData.tags.BPS !== 'undefined') {
		audioBitrate = audioData.tags.BPS; 
	}

	var audio = {
		"index": audioData.index,
		"channels": audioData.channels,
		"bit_rate": audioBitrate,
		"language": language,
		"bit_rate_per_channel": audioData.bit_rate / audioData.channels
	}
	return audio;
};

var parseSubtitleInfo = function(subtitleData) {
    var lang; 
	if (typeof subtitleData.tags !== 'undefined') {
        lang = subtitleData.tags.language;
    } else {
        lang = "undefined";
    }
	var subtitle = {
		"index": subtitleData.index,
		"default": subtitleData.disposition.default,
		"forced": subtitleData.disposition.forced,
		"language": lang
	}
	return subtitle;
};

var estimateVideoBitrate = function(media) {
	var audioSize = 0;
	media.audio.forEach(function(audio) {
		audioSize += audio.bit_rate * media.duration;
	});
	return (media.size * 8 - audioSize) / media.duration;
};

var getMediaJson = function(inputFile, callback) {
	var ffprobe = spawn('ffprobe', ['-loglevel', 'error',
		 '-of', 'json',
		 '-show_streams', '-show_format',
		 inputFile], 
		 { env: process.env});

	var infoJson = "";
	var error = "";

	ffprobe.stdout.on('data', function (data) {
  		infoJson += data;
	});

	ffprobe.stderr.on('data', function (data) {
  		error += data;
	});

	ffprobe.on('close', function (code) {
		if(code != 0) {
			console.log(error);
			process.exit(1);
		}
		callback(infoJson);
	});
};

var getCommandpath = function(commandName, callback) {
	exec('which ' + commandName, function(err, stdout) {
      if (err) {
        // Treat errors as not found
        callback('');
      } else {
        callback(stdout.trim());
      }
    });
};

var assembleFFmpegOptions = function(outputMedia) {
	var options = [];

	// overwrite files
	options.push('-y');

	// input file
	options.push('-i');
	options.push(inputFile);

	// output file format
	options.push('-f');
	options.push('matroska');

	// Video
	var video = outputMedia.video;
	options.push('-map');
	options.push('0:' + video.source_index);
	options.push('-c:v');
	if(video.bit_rate > 0) {
		options.push('libx264');
		options.push('-b:v');
		options.push(video.bit_rate);
		options.push('-preset');
		options.push('veryslow');
		options.push('-profile:v');
		options.push('high');
		options.push('-level');
		options.push('4.1');
	} else {
		options.push('copy');
	}
	options.push('-strict');
	options.push('experimental');

	// Audio
	var audio = outputMedia.audio;
	var audioId = 0;
	for(var i in audio) {
		options.push('-map');
		options.push('0:' + audio[i].source_index);
		options.push('-c:a:' + audioId);
		if(audio[i].copy_audio) {
			options.push('copy');
		} else {		
			options.push('libfdk_aac');
			options.push('-b:a:' + audioId);
			options.push(audio[i].bit_rate);
		}
		audioId += 1;
	}

	//Subtitles
	var subtitleId = 0;
	var subtitle = outputMedia.subtitle;
	for(var i in outputMedia.subtitle) {
		options.push('-map');
		options.push('0:' + subtitle[i].source_index);
		options.push('-c:s:' + subtitleId);
		options.push('copy');
		subtitleId += 1;
	}

	// Outputfile
	options.push(outputFile);
	return options;
};


getMediaJson(inputFile, function(json) {
	var mediaInfo = JSON.parse(json);

	var outputMedia = parseMediaInfo(mediaInfo);

	var options = assembleFFmpegOptions(outputMedia);

	var timeStart = new Date();
	var ffmpeg = spawn('ffmpeg', options, { env: process.env});
	var encodingStats = {};
	encodingStats.startTime = Date.now() / 1000;
	encodingStats.videoLength = outputMedia.duration;

	ffmpeg.stdout.on('data', function (data) {
  		console.log('stdout: ' + data);
	});

	ffmpeg.stderr.on('data', function (data) {
		var line = data + '';
		if (line.indexOf('frame=') > -1) {

			var lineData = line.split('=');
			var timeStr = lineData[5].split(' ')[0];
			encodingStats.currentEncTime=(Number(timeStr.split(':')[0]) * 3600
				+ Number(timeStr.split(':')[1]) * 60
				+ Number(timeStr.split(':')[2]));
			encodingStats.percentDone = 100 * encodingStats.currentEncTime / encodingStats.videoLength 
			encodingStats.eta =  ((Date.now() / 1000) - encodingStats.startTime) * (1 - (encodingStats.currentEncTime / encodingStats.videoLength));
			var etaTime = new Date(0);
			etaTime.setSeconds(encodingStats.eta);
			var etaStr = etaTime.getHours() + ':' + etaTime.getMinutes() + ':' + etaTime.getSeconds();
			process.stdout.write('Done: ' + encodingStats.percentDone + ' % ETA: ' + encodingStats.eta + '\r');
		}
	});

	ffmpeg.on('close', function (code) {
	  console.log('child process exited with code ' + code);
	});
});
