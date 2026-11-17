require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { downloadAudio, processAudioToSubtitle } = require('./utils/audioPipeline');

const app = express();
const PORT = process.env.PORT || 5000;

// 1. CORS 및 크롬 PNA (Private Network Access) 차단 해제 설정
app.use(cors({ origin: '*' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});
app.use(express.json());

// 2. 서버 상태 확인 엔드포인트
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'AI 발음 자막 서버가 정상 작동 중입니다.' });
});

// 3. 실제 유튜브 오디오 처리 및 AI 자막 생성 API (targetLang 반영)
app.post('/api/process-video', async (req, res) => {
  const { videoUrl, targetLang } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl이 필요합니다.' });

  const videoId = Date.now().toString();

  try {
    console.log(`[음원 추출 중...] URL: ${videoUrl}, 선택 언어: ${targetLang || 'ko'}`);
    const audioPath = await downloadAudio(videoUrl, videoId);

    console.log(`[AI 발음 변환 분석 중... (${targetLang || 'ko'})]`);
    // targetLang 파라미터 전달 (기본값: 'ko')
    const subtitleData = await processAudioToSubtitle(audioPath, targetLang || 'ko');

    // 임시 추출 음원 파일 삭제
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

    res.json({ success: true, subtitles: subtitleData });
  } catch (err) {
    console.error('자막 생성 처리 에러:', err);
    res.status(500).json({ success: false, error: '자막 생성 중 오류가 발생했습니다.' });
  }
});

// 4. MP3 음원 파일 직접 다운로드 API
app.get('/api/download-mp3', async (req, res) => {
  const { videoUrl, title } = req.query;
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl이 필요합니다.' });

  const fileId = `download_${Date.now()}`;

  try {
    console.log(`[MP3 다운로드 추출 중...] URL: ${videoUrl}`);
    const audioPath = await downloadAudio(videoUrl, fileId);

    const safeTitle = (title || 'youtube_audio').replace(/[\\/:*?"<>|]/g, '_');
    const downloadFileName = `${safeTitle}.mp3`;

    // 파일 전송 완료 후 서버 내 임시 파일 자동 삭제
    res.download(audioPath, downloadFileName, (err) => {
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }
      if (err && !res.headersSent) {
        console.error('MP3 전송 중 오류 발생:', err);
      }
    });
  } catch (err) {
    console.error('MP3 다운로드 처리 에러:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'MP3 음원 추출 중 오류가 발생했습니다.' });
    }
  }
});

app.listen(PORT, () => console.log(`🚀 서버 구동 중: http://localhost:${PORT}`));