const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// yt-dlp를 이용한 단일 음원 다운로드 및 MP3 변환 (Node JS 런타임 & 읽기 전용 쿠키 우회 적용)
async function downloadAudio(videoUrl, outputFileName) {
  return new Promise((resolve, reject) => {
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const outputPath = path.join(tempDir, `${outputFileName}.mp3`);
    const ytDlpBinary = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    const ytDlpPath = path.join(__dirname, '..', ytDlpBinary);

    // Render Secret File(/etc/secrets/cookies.txt)은 읽기 전용이므로 쓰기 가능한 temp 폴더로 임시 복사
    const renderCookiePath = '/etc/secrets/cookies.txt';
    const localCookiePath = path.join(__dirname, '../cookies.txt');
    const sourceCookiePath = fs.existsSync(renderCookiePath)
      ? renderCookiePath
      : (fs.existsSync(localCookiePath) ? localCookiePath : null);

    let tempCookiePath = null;
    if (sourceCookiePath) {
      tempCookiePath = path.join(tempDir, `cookies_${outputFileName}.txt`);
      fs.copyFileSync(sourceCookiePath, tempCookiePath);
    }

    const cleanupTempCookie = () => {
      if (tempCookiePath && fs.existsSync(tempCookiePath)) {
        try {
          fs.unlinkSync(tempCookiePath);
        } catch (_) {}
      }
    };

    const args = [
      '--no-playlist',
      '--js-runtimes', `node:${process.execPath}`,
      '--remote-components', 'ejs:github',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '--ffmpeg-location', ffmpegPath,
      '-x',
      '--audio-format', 'mp3',
      '-o', outputPath
    ];

    if (tempCookiePath) {
      console.log(`[유튜브 인증 쿠키 적용됨: ${tempCookiePath}]`);
      args.push('--cookies', tempCookiePath);
    } else {
      args.push('--extractor-args', 'youtube:player_client=android,web');
    }

    args.push(videoUrl);

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
      cleanupTempCookie();
      if (code === 0) {
        console.log('[yt-dlp 음원 추출 완료]');
        resolve(outputPath);
      } else {
        reject(new Error(`yt-dlp 실패 (코드 ${code})`));
      }
    });

    child.on('error', (err) => {
      cleanupTempCookie();
      reject(err);
    });
  });
}

// OpenAI Whisper STT + GPT-4o-mini ID 기반 1:1 정밀 다국어 연음 매핑 파이프라인
async function processAudioToSubtitle(audioPath, targetLang = 'ko') {
  console.log(`[OpenAI Whisper 정밀 음성/단어 타임스탬프 추출 중... (발음 언어: ${targetLang})]`);

  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment', 'word']
  });

  const segments = transcription.segments || [];
  const words = transcription.words || [];

  if (segments.length === 0) return [];

  console.log(`[GPT-4o-mini ID 매핑 기반 (${targetLang}) 연음 발음 및 뜻 번역 생성 중...]`);

  const inputItems = segments.map((s, index) => {
    const segWords = words.filter(w => w.start >= s.start - 0.15 && w.end <= s.end + 0.15);
    return {
      id: index,
      text: s.text.trim(),
      words: segWords.map(w => w.word.trim())
    };
  });

  let langInstruction = '';
  if (targetLang === 'en') {
    langInstruction = `
2. pronunciation & pronunciationWords: 사전식 번역 금지. 가수가 실제 발음하는 소리 그대로 '영어 알파벳(Phonetic / Romaji)'으로 표기하라.
   - 예시: "始めから" -> pronunciation: "(Hajimekara)", pronunciationWords: ["Hajime", "kara"]
   - 예시: "over that" -> pronunciation: "(Over-day)", pronunciationWords: ["Over", "day"]`;
  } else if (targetLang === 'ja') {
    langInstruction = `
2. pronunciation & pronunciationWords: 사전식 번역 금지. 가수가 실제 발음하는 연음/억양 소리 그대로 '일본어 가타카나(Katakana)'로 연결해 표기하라.
   - 예시: "if I" -> pronunciation: "(イファイ)", pronunciationWords: ["イファイ"]
   - 예시: "said I" -> pronunciation: "(セダイ)", pronunciationWords: ["セダイ"]`;
  } else {
    langInstruction = `
2. pronunciation & pronunciationWords: 사전식 번역 금지. 가수가 실제 발음하는 소리 그대로 오직 '한글(한국어 글자)'로만 작성하라. (원문의 알파벳, 한자, 히라가나, 가타카나 등 외래문자를 단 한 글자도 포함하지 마라)
   - 일본어 발음 정밀 규칙:
     * 'つ'는 반드시 '츠'로 표기('즈' 금지), 'ず/づ'만 '즈'로 표기
     * 'ちゅ/しゅ/じゅ'는 각각 '츄/슈/쥬'로 표기('추/수/주' 금지)
     * 한자어는 일본어 실제 독음과 가창 연음을 반영하여 자연스럽게 표기
     * 예시: "して言うならお都合主義かな流された中継地" -> pronunciation: "(시테 유우 나라 오츠고우슈기 카나 나가사레타 츄우케이치)"
     * 예시: "始めからやり直せたら" -> pronunciation: "(하지메카라 야리나오세타라)"
   - 영어 발음 정밀 규칙:
     * 예시: "over that" -> pronunciation: "(오버데)"`;
  }

  const gptResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `외국어 가사 목록(id, text, words)을 받아 각 id에 1:1로 정확히 대응되는 1) 연음 발음(pronunciation), 2) 단어별 연음 배열(pronunciationWords), 3) 한국어 뜻 번역(translation)을 JSON 구조로 반환해줘.

[절대 준수 규칙 - ID 매핑 & 발음 표기 강제]
1. 입력받은 모든 id 항목을 단 하나도 생략하거나 합치지 말고, 동일한 id를 부여하여 "result" 배열에 담아 응답하라.
${langInstruction}
3. pronunciationWords: 원문의 words 배열과 1:1 대응하는 발음 단어 배열. 단, 일본어/중국어처럼 원문 words가 한 글자씩 쪼개져 있는 경우에도 절대 원문 글자를 그대로 남기지 말고 전체 문장의 발음을 자연스럽게 분할하라.
4. translation: 해당 문장의 자연스러운 한국어 뜻 번역

응답 형식 예시:
{
  "result": [
    {
      "id": 0,
      "pronunciation": "(시테 유우 나라 오츠고우슈기 카나 나가사레타 츄우케이치)",
      "pronunciationWords": ["시테", "유우", "나라", "오츠고우슈기", "카나", "나가사레타", "츄우케이치"],
      "translation": "말한다면 편의주의일까 흘러간 중계지"
    }
  ]
}`
      },
      {
        role: 'user',
        content: JSON.stringify(inputItems)
      }
    ],
    response_format: { type: "json_object" }
  });

  let resultMap = {};
  try {
    const rawContent = gptResponse.choices[0].message.content.trim();
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    const jsonParsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
    const items = Array.isArray(jsonParsed) ? jsonParsed : (jsonParsed.result || jsonParsed.items || []);

    items.forEach((item) => {
      if (item && item.id !== undefined) {
        resultMap[item.id] = item;
      }
    });
  } catch (e) {
    console.error('GPT 응답 파싱 실패:', e);
  }

  return segments.map((seg, idx) => {
    const matched = resultMap[idx] || {};
    const textClean = seg.text.trim();

    // 한글 모드일 때 혹시라도 남아있을 수 있는 일본어(히라가나/가타카나/한자) 문자 2차 필터링
    let cleanPronunciation = matched.pronunciation || `(${textClean})`;
    if (targetLang === 'ko') {
      cleanPronunciation = cleanPronunciation.replace(/[\u3040-\u30FF\u4E00-\u9FAF]/g, '').replace(/\s+/g, ' ').trim();
    }

    const segWords = words.filter(w => w.start >= seg.start - 0.15 && w.end <= seg.end + 0.15);
    const pronWords = Array.isArray(matched.pronunciationWords) ? matched.pronunciationWords : [];

    // 단어 개수가 정확히 일치할 때만 단어 단위 매핑 사용 (일본어처럼 글자 단위로 쪼개져 원문이 섞이는 현상 방지)
    const isWordCountMatched = segWords.length > 0 && segWords.length === pronWords.length;

    const wordDetails = isWordCountMatched
      ? segWords.map((w, wIdx) => ({
          word: w.word.trim(),
          pronunciation: pronWords[wIdx],
          start: Number(w.start.toFixed(2)),
          end: Number(segWords[wIdx + 1] ? segWords[wIdx + 1].start.toFixed(2) : w.end.toFixed(2))
        }))
      : [];

    return {
      start: Number(seg.start.toFixed(2)),
      end: Number(seg.end.toFixed(2)),
      text: textClean,
      pronunciation: cleanPronunciation,
      translation: matched.translation || textClean,
      words: wordDetails
    };
  });
}

module.exports = {
  downloadAudio,
  processAudioToSubtitle
};