const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

// 오디오 파일 전처리 (16kHz, mono wav 변환)
function processAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('wav')
      .audioFrequency(16000)
      .audioChannels(1)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

module.exports = { processAudio };