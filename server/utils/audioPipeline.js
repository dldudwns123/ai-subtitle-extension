const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// yt-dlp.exe를 이용한 단일 음원 다운로드 및 MP3 변환
async function downloadAudio(videoUrl, outputFileName) {
  return new Promise((resolve, reject) => {
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const outputPath = path.join(tempDir, `${outputFileName}.mp3`);
    const ytDlpPath = path.join(__dirname, '../yt-dlp.exe');

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

// OpenAI Whisper STT + GPT-4o-mini 다국어(일본어 포함) 한글 발음 및 번역 파이프라인
async function processAudioToSubtitle(audioPath) {
  console.log('[OpenAI Whisper 정밀 음성 인식 처리 중...]');
  
  // 1. Whisper API 타임스탬프 파싱
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment']
  });

  const segments = transcription.segments || [];
  if (segments.length === 0) return [];

  console.log('[GPT-4o-mini 다국어 한글 연음 발음 및 뜻 번역 생성 중...]');
  const originalTexts = segments.map((s) => s.text);

  // 2. GPT-4o-mini로 들리는 발음과 자연스러운 번역 일괄 생성
  const gptResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `외국어(영어, 일본어, 중국어 등) 문장 배열을 받아 각 요소별로 1) 실제 청각 소리 그대로의 한글 발음, 2) 자연스러운 한국어 뜻 번역을 포함하는 동일한 크기의 JSON 배열로 반환해줘.

[핵심 발음 규칙]
1. pronunciation 항목은 무조건 소리 나는 대로 오직 '한글(한국어 글자)'로만 작성하라. (절대 원문의 알파벳, 한자, 히라가나, 카타카나를 포함하지 마라)
2. 일본어 처리 예시:
   - 원문: "始めからやり直せたら" -> pronunciation: "(하지메카라 야리나오세타라)"
   - 원문: "愛してる" -> pronunciation: "(아이시테루)"
3. 영어 처리 예시:
   - 가수의 실제 연음/억양 소리 그대로 표기 (예: "over that" -> "(오버데)")
4. translation: 문장의 자연스러운 한국어 뜻 번역

응답 형식 예시:
[
  {
    "pronunciation": "(하지메카라 야리나오세타라)",
    "translation": "처음부터 다시 시작할 수 있다면"
  }
]`
      },
      {
        role: 'user',
        content: JSON.stringify(originalTexts)
      }
    ],
    response_format: { type: "json_object" }
  });

  let parsedResults = [];
  try {
    const rawContent = gptResponse.choices[0].message.content.trim();
    const jsonParsed = JSON.parse(rawContent);
    parsedResults = Array.isArray(jsonParsed) ? jsonParsed : (jsonParsed.result || jsonParsed.items || []);
  } catch (e) {
    parsedResults = originalTexts.map((text) => ({
      pronunciation: `(${text})`,
      translation: text
    }));
  }

  // 3. 타임스탬프 결합 반환
  return segments.map((seg, idx) => ({
    start: Number(seg.start.toFixed(2)),
    end: Number(seg.end.toFixed(2)),
    text: seg.text,
    pronunciation: parsedResults[idx]?.pronunciation || `(${seg.text})`,
    translation: parsedResults[idx]?.translation || seg.text
  }));
}

module.exports = {
  downloadAudio,
  processAudioToSubtitle
};
