const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path; // ffprobe 경로 추가
const ffmpeg = require('fluent-ffmpeg');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ffmpeg 및 ffprobe 경로 등록
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// Gemini API 초기화
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// yt-dlp.exe를 이용한 단일 음원 다운로드 및 MP3 변환 (403 Forbidden 우회 옵션 적용)
async function downloadAudio(videoUrl, outputFileName) {
  return new Promise((resolve, reject) => {
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const outputPath = path.join(tempDir, `${outputFileName}.mp3`);
    const ytDlpPath = path.join(__dirname, '../yt-dlp.exe');

    // 403 Forbidden 및 차단 회피를 위한 모바일/iOS 파라미터 및 플레이리스트 제외 설정
    const args = [
      '--no-playlist',
      '--extractor-args', 'youtube:player_client=android,web',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--ffmpeg-location', ffmpegPath,
      '-x',
      '--audio-format', 'mp3',
      '-o', outputPath,
      videoUrl
    ];

    console.log('[yt-dlp 음원 추출 시작...]');
    const child = spawn(ytDlpPath, args);

    child.stdout.on('data', (data) => {
      const message = data.toString();
      if (message.includes('[download]') || message.includes('[ExtractAudio]')) {
        console.log(`[yt-dlp 진행] ${message.trim()}`);
      }
    });

    child.stderr.on('data', (data) => {
      console.error(`[yt-dlp 경고/에러] ${data.toString().trim()}`);
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log('[yt-dlp 음원 추출 완료]');
        resolve(outputPath);
      } else {
        reject(new Error(`yt-dlp 실패 (코드 ${code})`));
      }
    });

    child.on('error', (err) => reject(err));
  });
}

// 오디오 파일의 총 길이(초) 구하기
function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

// 오디오를 특정 구간(시작, 길이) 분할 추출
function splitAudioChunk(inputPath, outputPath, startTime, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(startTime)
      .setDuration(duration)
      .save(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err));
  });
}

// Base64 변환
function fileToGenerativePart(filePath, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(filePath)).toString('base64'),
      mimeType
    },
  };
}

// 개별 조각(Chunk)에 대한 Gemini 자막 분석 요청 (유효 모델 라인업 및 재시도 보강)
async function analyzeChunk(chunkPath, timeOffset) {
  // 현재 구글 AI API에서 정상 동작하는 실효 유효 모델 명칭
  const modelsToTry = [
    'gemini-3.8-flash',
    'gemini-2.5-flash',
    'gemini-1.5-flash'
  ];
  
  const audioPart = fileToGenerativePart(chunkPath, 'audio/mp3');

  const prompt = `
  이 오디오 구간을 정밀하게 분석하여 가수가 실제 발음하는 "음향적 청각 소리 그대로" 한글 자막을 생성해줘.

  [핵심 발음 표기 규칙]
  1. 사전식 번역 금지. 실제 입에서 나오는 연음/억양 소리대로 한글 표기하라.
     - 예시: "over that" -> "(오버데)", "what do you" -> "(왓듀)"
  2. start와 end는 오디오 내에서의 시작/종료 초 단위 숫자(소수점 포함 예: 1.25)로 표시하라.
  3. text: 외국어 원문 가사
  4. pronunciation: 실제 들리는 한글 발음

  반드시 아래 JSON 배열 형식으로만 응답해:
  [
    {
      "start": 1.25,
      "end": 3.50,
      "text": "over that",
      "pronunciation": "(오버데)"
    }
  ]
  `;

  for (const modelName of modelsToTry) {
    // 모델당 최대 2회 재시도
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[Gemini 모델 시도: ${modelName} (시도 ${attempt}/2)]`);
        const model = genAI.getGenerativeModel({ 
          model: modelName,
          generationConfig: { responseMimeType: 'application/json' }
        });

        const result = await model.generateContent([prompt, audioPart]);
        const responseText = result.response.text().trim();
        const cleanedText = responseText.replace(/```json|```/g, '').trim();
        const subtitles = JSON.parse(cleanedText);

        if (!Array.isArray(subtitles) || subtitles.length === 0) {
          throw new Error('유효하지 않거나 비어있는 JSON 응답');
        }

        console.log(`[${modelName} 자막 분석 완료: ${subtitles.length}개 항목 생성]`);
        return subtitles.map((sub) => ({
          ...sub,
          start: Number((sub.start + timeOffset).toFixed(2)),
          end: Number((sub.end + timeOffset).toFixed(2))
        }));
      } catch (e) {
        console.error(`[${modelName} 시도 ${attempt} 실패]:`, e.message || e);
        
        // 503(일시적 트래픽) 또는 429(쿼터) 발생 시 3초 대기 후 재시도
        if (attempt < 2) {
          console.log('-> 3초 대기 후 재시도합니다...');
          await new Promise((res) => setTimeout(res, 3000));
        }
      }
    }
    console.log(`-> ${modelName} 모델 실패로 다음 대체 모델로 전환합니다.`);
  }

  return [];
}

// 전체 오디오를 180초(3분) 단위로 분할하여 API 호출 횟수를 최소화하고 쿼터 초과 방지
async function processAudioToSubtitle(audioPath) {
  console.log('[음원 구간 분할 및 정밀 분석 준비 중...]');
  const duration = await getAudioDuration(audioPath);
  const chunkSize = 180; // 3분 단위로 확대 (API 호출 횟수 감축)
  const totalChunks = Math.ceil(duration / chunkSize);

  console.log(`[총 영상 길이: ${Math.round(duration)}초 -> ${totalChunks}개 구간으로 처리]`);

  let allSubtitles = [];

  for (let i = 0; i < totalChunks; i++) {
    const startTime = i * chunkSize;
    const chunkPath = path.join(path.dirname(audioPath), `temp_chunk_${i}.mp3`);

    console.log(`[분할 구간 분석 중 (${i + 1}/${totalChunks}): ${startTime}초 ~ ${Math.min(startTime + chunkSize, Math.round(duration))}초]`);
    
    try {
      await splitAudioChunk(audioPath, chunkPath, startTime, chunkSize);
      const chunkSubtitles = await analyzeChunk(chunkPath, startTime);
      allSubtitles = allSubtitles.concat(chunkSubtitles);

      if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);

      // 429 Rate Limit 방지를 위해 각 호출 사이에 3초간 대기
      if (i < totalChunks - 1) {
        console.log('[API 쿼터 보호를 위해 3초간 대기 중...]');
        await new Promise((res) => setTimeout(res, 3000));
      }
    } catch (err) {
      console.error(`구간 ${i + 1} 분석 중 오류 발생:`, err);
    }
  }

  allSubtitles.sort((a, b) => a.start - b.start);
  console.log(`[전체 AI 자막 분석 완료: 총 ${allSubtitles.length}개 정밀 구간 생성]`);
  return allSubtitles;
}

module.exports = {
  downloadAudio,
  processAudioToSubtitle
};