/* global process, __dirname */

var waterfall = require('async-waterfall');
var fs = require('fs');
var callNextTick = require('call-next-tick');
var randomId = require('idmaker').randomId;
var oknok = require('oknok');
var curry = require('lodash.curry');
var Jimp = require('jimp');
var postIt = require('@jimkang/post-it');
var request = require('request');
var bodyMover = require('request-body-mover');

var shotRetries = 0;
var shotRetryLimit = 5;

if (process.env.BOT) {
  // Big assumption that this module will be in <project dir>/node_modules/run-shotbot.
  var configPath = __dirname + '/../../configs/' + process.env.BOT + '-config';
  var behaviorPath = __dirname + '/../../behaviors/' + process.env.BOT + '-behavior';
} else {
  console.log('Usage: BOT=botname node post-shot.js [--dry]');
  process.exit();
}

var config = require(configPath);
var behavior = require(behaviorPath);

var dryRun = false;
if (process.argv.length > 2) {
  dryRun = process.argv[2].toLowerCase() == '--dry';
}

function kickOff({ snapperURL, snapperKey }) {
  try {
    waterfall(
      [
        curry(getShot)({ snapperURL, snapperKey }),
        cropImage,
        postToTargets
      ],
      wrapUp
    );
  } catch (e) {
    retry();
  }

  function wrapUp(error, data) {
    if (error) {
      console.log(error, error.stack);

      if (data) {
        console.log('data:', data);
      }
      retry(error);
    } else if (!dryRun) {
      console.log('Posted to targets!');
    }
  }

  function retry(e) {
    console.log('Error while trying to get shot:', e);
    if (shotRetries < shotRetryLimit) {
      shotRetries += 1;
      console.log('Retrying. Number of retries so far:', shotRetries);
      callNextTick(kickOff, { snapperURL, snapperKey });
    } else {
      console.log('Reached retry limit. Giving up.');
      process.exit();
    }
  }


}

function getShot({ snapperURL, snapperKey }, done) {
  behavior.generateImageURL(oknok({ ok: getImageWithMetadata, nok: done }));

  function getImageWithMetadata({ url, altText, caption, targetTexts }) {
    behavior.webimageOpts.url = url;

    var reqOpts = {
      method: 'POST',
      url: snapperURL,
      body: behavior.webimageOpts,
      binary: true,
      headers: {
        Authorization: `Bearer ${snapperKey}`,
        'Content-Type': 'application/json'
      }
    };
    request(reqOpts, bodyMover(oknok({ ok: passImageWithMetadata, nok: done })));

    function passImageWithMetadata(buffer) {
      done(null, { buffer, altText, caption, targetTexts });
    }
  }
}

function cropImage({ buffer, altText, caption, targetTexts }, done) {
  if (behavior.shouldAutoCrop) {
    Jimp.read(buffer, oknok({ ok: doCrop, nok: done }));
  } else {
    callNextTick(done, null, { buffer, altText, caption, targetTexts });
  }

  function doCrop(image) {
    image.autocrop();
    image.getBuffer(Jimp.AUTO, oknok({ ok: passCroppedBuffer, nok: done }));
  }

  function passCroppedBuffer(cropped) {
    done(null, { buffer: cropped, altText, caption, targetTexts });
  }
}

function postToTargets({ buffer, altText, caption, targetTexts }, done) {
  if (dryRun) {
    let filePath =
      'scratch/' +
      altText +
      '-' +
      new Date().toISOString().replace(/:/g, '-') +
      '.png';

    console.log('Writing out', filePath);
    fs.writeFileSync(filePath, buffer);
    callNextTick(done, null, buffer);
  } else {
    let id = behavior.archive.idPrefix + '-' + randomId(8);
    let targets = behavior.postingTargets.map(curry(getConfigForTarget)(targetTexts));
    postIt(
      {
        id,
        text: caption,
        altText,
        mediaFilename: id + '.png',
        buffer,
        targets
      },
      done
    );
  }
}

function getConfigForTarget(targetTexts, target) {
  var opts = {
    type: target,
    config: target === 'archive' ? behavior[target] : config[target],
  };
  if (targetTexts && target in targetTexts) {
    opts.text = targetTexts[target];
  }
  return opts;
}

module.exports = kickOff;
