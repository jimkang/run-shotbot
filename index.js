/* global process */

var waterfall = require('async-waterfall');
var Webimage = require('webimage');
var fs = require('fs');
var callNextTick = require('call-next-tick');
var randomId = require('idmaker').randomId;
var sb = require('standard-bail')();
var curry = require('lodash.curry');
var Jimp = require('jimp');
var postIt = require('@jimkang/post-it');

var shotRetries = 0;
var shotRetryLimit = 5;

if (process.env.BOT) {
  var configPath = './configs/' + process.env.BOT + '-config';
  var behaviorPath = './behaviors/' + process.env.BOT + '-behavior';
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

var webimage;

kickOff();

function kickOff() {
  try {
    waterfall(
      [
        curry(Webimage)({ executablePath: process.env.CHROMEPATH }),
        getShot,
        shutDownWebimage,
        cropImage,
        postToTargets
      ],
      wrapUp
    );
  } catch (e) {
    retry();
  }
}

function getShot(webImageInst, done) {
  webimage = webImageInst;
  if (behavior.generateImageURL) {
    behavior.generateImageURL(sb(getImageWithMetadata, done));
  } else {
    webimage.getImage(
      behavior.webimageOpts,
      sb(passImageWithBehaviorMetadata, done)
    );
  }

  function getImageWithMetadata({ url, altText, caption }) {
    behavior.webimageOpts.url = url;
    webimage.getImage(behavior.webimageOpts, sb(passImageWithMetadata, done));

    function passImageWithMetadata(buffer) {
      done(null, { buffer, altText, caption });
    }
  }

  function passImageWithBehaviorMetadata(buffer) {
    done(null, {
      buffer,
      altText: behavior.getAltText(),
      caption: behavior.getCaption()
    });
  }
}

function shutDownWebimage(result, done) {
  webimage.shutDown(passResult);

  function passResult(error) {
    done(error, result);
  }
}

function cropImage({ buffer, altText, caption }, done) {
  if (behavior.shouldAutoCrop) {
    Jimp.read(buffer, sb(doCrop, done));
  } else {
    callNextTick(done, null, { buffer, altText, caption });
  }

  function doCrop(image) {
    image.autocrop();
    image.getBuffer(Jimp.AUTO, sb(passCroppedBuffer, done));
  }

  function passCroppedBuffer(cropped) {
    done(null, { buffer: cropped, altText, caption });
  }
}

function postToTargets({ buffer, altText, caption }, done) {
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
    postIt(
      {
        id,
        text: caption,
        altText,
        mediaFilename: id + '.png',
        buffer,
        targets: behavior.postingTargets.map(getConfigForTarget)
      },
      done
    );
  }
}

function getConfigForTarget(target) {
  return {
    type: target,
    config: target === 'archive' ? behavior[target] : config[target]
  };
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
    callNextTick(kickOff);
  } else {
    console.log('Reached retry limit. Giving up.');
  }
}
