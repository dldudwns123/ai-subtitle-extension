require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { downloadAudio, processAudioToSubtitle } = require('./utils/audioPipeline');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: '*' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});
app.use(express.json());

// 실제 유튜브 오디오 처리 및 자막 생성을 위한 API
app.post('/api/process-video', async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'URL이 필요합니다.' });

  const videoId = Date.now().toString();

  try {
    console.log(`[음원 추출 중...] URL: ${videoUrl}`);
    const audioPath = await downloadAudio(videoUrl, videoId);

    console.log(`[AI 발음 변환 분석 중...]`);
    const subtitleData = await processAudioToSubtitle(audioPath);

    // 임시 파일 삭제
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

    res.json({ success: true, subtitles: subtitleData });
  } catch (err) {
    console.error('처리 에러:', err);
    res.status(500).json({ error: '자막 생성 중 오류가 발생했습니다.' });
  }
});

app.listen(PORT, () => console.log(`🚀 서버 구동 중: http://localhost:${PORT}`));