const SERVER_URL = 'http://localhost:5000';
let currentSubtitles = [];
let videoElement = null;
let currentTargetLang = 'ko'; // 기본 발음 언어: 한글

// 1. 자막 오버레이 레이아웃 생성
function createSubtitleOverlay() {
  if (document.getElementById('ai-subtitle-container')) return;

  const container = document.createElement('div');
  container.id = 'ai-subtitle-container';
  container.style.cssText = `
    position: absolute; bottom: 85px; left: 50%; transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.88); color: #ffffff; padding: 14px 28px;
    border-radius: 12px; text-align: center; z-index: 9999; pointer-events: none;
    box-shadow: 0 4px 15px rgba(0,0,0,0.6); font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
    max-width: 90%;
  `;

  container.innerHTML = `
    <style>
      .char-base { color: #ffffff; transition: color 0.03s linear; }
      .char-active { color: #00a2ff; font-weight: bold; text-shadow: 0 0 8px rgba(0,162,255,0.8); }
      .word-group { display: inline-block; white-space: nowrap; }
    </style>

    <!-- 1단: 외국어 원문 가사 -->
    <div id="sub-original-wrap" style="font-size: 22px; font-weight: bold; margin-bottom: 4px; display: block; word-break: keep-all;">
      <span id="orig-container" style="color: #ffffff;">자막 준비 중...</span>
    </div>

    <!-- 2단: 연음 발음 -->
    <div id="sub-pronunciation-wrap" style="font-size: 25px; font-weight: 800; display: block; margin-top: 2px; letter-spacing: 1px; word-break: keep-all;">
      <span id="pron-container" style="color: #ffffff;">(영상을 재생하면 실시간 발음이 나옵니다)</span>
    </div>

    <!-- 3단: 한국어 뜻 번역 -->
    <div id="sub-translation-wrap" style="font-size: 16px; color: #81D4FA; font-weight: 500; margin-top: 6px; display: block; word-break: keep-all;">
      <span id="trans-text"></span>
    </div>
  `;

  const player = document.querySelector('#movie_player') || document.body;
  player.appendChild(container);
}

// 2. 텍스트 및 단어 데이터를 글자 단위 <span> 구조로 동적 분할 생성
function renderTextSpans(containerId, textData, wordsData) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  if (wordsData && wordsData.length > 0) {
    wordsData.forEach((w, wIdx) => {
      const wordSpan = document.createElement('span');
      wordSpan.className = 'word-group';
      wordSpan.dataset.wordIndex = wIdx;
      wordSpan.dataset.start = w.start;
      wordSpan.dataset.end = w.end;

      const targetText = (containerId === 'pron-container') ? (w.pronunciation || w.word) : w.word;

      Array.from(targetText).forEach((char, cIdx) => {
        const span = document.createElement('span');
        span.innerText = char;
        span.className = 'char-base';
        span.dataset.charIndex = cIdx;
        wordSpan.appendChild(span);
      });

      container.appendChild(wordSpan);

      if (wIdx < wordsData.length - 1) {
        const spaceSpan = document.createElement('span');
        spaceSpan.innerText = ' ';
        container.appendChild(spaceSpan);
      }
    });
  } else if (textData) {
    Array.from(textData).forEach((char, index) => {
      const span = document.createElement('span');
      span.innerText = char;
      span.className = 'char-base';
      span.dataset.index = index;
      container.appendChild(span);
    });
  }
}

// 3. 실시간 박자 밀착 노래방 동기화
function startSubtitleSync() {
  videoElement = document.querySelector('video');
  if (!videoElement) return;

  let lastSub = null;

  function updateKaraokeSync() {
    if (currentSubtitles.length > 0 && videoElement) {
      const currentTime = videoElement.currentTime;

      const currentSub = currentSubtitles.find(
        (sub) => currentTime >= sub.start && currentTime <= sub.end
      );

      const origContainer = document.getElementById('orig-container');
      const pronContainer = document.getElementById('pron-container');
      const transText = document.getElementById('trans-text');

      if (origContainer && pronContainer && transText) {
        if (currentSub) {
          if (lastSub !== currentSub) {
            lastSub = currentSub;
            transText.innerText = currentSub.translation || '';
            renderTextSpans('orig-container', currentSub.text || '', currentSub.words);
            renderTextSpans('pron-container', currentSub.pronunciation || '', currentSub.words);
          }

          if (currentSub.words && currentSub.words.length > 0) {
            ['orig-container', 'pron-container'].forEach((containerId) => {
              const targetEl = document.getElementById(containerId);
              if (!targetEl) return;

              const wordGroups = targetEl.querySelectorAll('.word-group');
              wordGroups.forEach((wGroup) => {
                const wStart = parseFloat(wGroup.dataset.start);
                const wEnd = parseFloat(wGroup.dataset.end);
                const charSpans = wGroup.querySelectorAll('.char-base');

                if (currentTime >= wEnd) {
                  charSpans.forEach((s) => s.classList.add('char-active'));
                } else if (currentTime < wStart) {
                  charSpans.forEach((s) => s.classList.remove('char-active'));
                } else {
                  const wDuration = Math.max(wEnd - wStart, 0.05);
                  const wElapsed = currentTime - wStart;
                  const wProgress = Math.min(Math.max(wElapsed / wDuration, 0), 1);
                  const activeIndex = Math.floor(wProgress * charSpans.length);

                  charSpans.forEach((s, idx) => {
                    if (idx <= activeIndex) {
                      s.classList.add('char-active');
                    } else {
                      s.classList.remove('char-active');
                    }
                  });
                }
              });
            });
          } else {
            const duration = Math.max(currentSub.end - currentSub.start, 0.05);
            const elapsed = currentTime - currentSub.start;
            const progress = Math.min(Math.max(elapsed / duration, 0), 1);

            const origSpans = origContainer.querySelectorAll('.char-base');
            if (origSpans.length > 0) {
              const activeOrigIndex = Math.floor(progress * origSpans.length);
              origSpans.forEach((span, i) => {
                if (i <= activeOrigIndex && progress > 0) {
                  span.classList.add('char-active');
                } else {
                  span.classList.remove('char-active');
                }
              });
            }

            const pronSpans = pronContainer.querySelectorAll('.char-base');
            if (pronSpans.length > 0) {
              const activePronIndex = Math.floor(progress * pronSpans.length);
              pronSpans.forEach((span, i) => {
                if (i <= activePronIndex && progress > 0) {
                  span.classList.add('char-active');
                } else {
                  span.classList.remove('char-active');
                }
              });
            }
          }
        } else {
          lastSub = null;
          origContainer.innerHTML = '';
          pronContainer.innerHTML = '';
          transText.innerText = '';
        }
      }
    }
    requestAnimationFrame(updateKaraokeSync);
  }

  updateKaraokeSync();
}

// 4. 자막 폰트 크기 조절
function updateSubtitleFontSize(baseSize) {
  const origWrap = document.getElementById('sub-original-wrap');
  const pronWrap = document.getElementById('sub-pronunciation-wrap');
  const transWrap = document.getElementById('sub-translation-wrap');

  if (origWrap) origWrap.style.fontSize = `${Math.round(baseSize * 0.88)}px`;
  if (pronWrap) pronWrap.style.fontSize = `${baseSize}px`;
  if (transWrap) transWrap.style.fontSize = `${Math.round(baseSize * 0.64)}px`;
}

// 5. 자막 배경 투명도 조절
function updateSubtitleOpacity(opacityPercent) {
  const container = document.getElementById('ai-subtitle-container');
  if (container) {
    const alpha = (opacityPercent / 100).toFixed(2);
    container.style.background = `rgba(0, 0, 0, ${alpha})`;
  }
}

// 6. 자막 및 MP3 파일 다운로드 유틸리티
function formatSRTTimestamp(seconds) {
  const pad = (num, size = 2) => String(num).padStart(size, '0');
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.round((seconds % 1) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
}

function triggerFileDownload(content, filename, contentType) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadSubtitleFile(format) {
  if (!currentSubtitles || currentSubtitles.length === 0) {
    alert('다운로드할 자막 데이터가 아직 분석되지 않았습니다. 영상 재생 후 다시 시도해 주세요.');
    return;
  }

  const rawTitle = document.title.replace('- YouTube', '').trim();
  const videoTitle = rawTitle.replace(/[\\/:*?"<>|]/g, '_') || 'AI_Subtitles';

  if (format === 'srt') {
    let srtContent = '';
    currentSubtitles.forEach((sub, index) => {
      const startTime = formatSRTTimestamp(sub.start);
      const endTime = formatSRTTimestamp(sub.end);
      srtContent += `${index + 1}\n${startTime} --> ${endTime}\n${sub.text}\n${sub.pronunciation}\n${sub.translation}\n\n`;
    });
    triggerFileDownload(srtContent, `${videoTitle}_자막.srt`, 'text/plain;charset=utf-8');
  } else if (format === 'txt') {
    let txtContent = `=== AI 실시간 발음 및 번역 가사 목록 ===\n영상 제목: ${rawTitle}\n\n`;
    currentSubtitles.forEach((sub, index) => {
      txtContent += `[${sub.start}초 ~ ${sub.end}초]\n`;
      txtContent += `원문: ${sub.text}\n`;
      txtContent += `발음: ${sub.pronunciation}\n`;
      txtContent += `번역: ${sub.translation}\n\n`;
    });
    triggerFileDownload(txtContent, `${videoTitle}_가사.txt`, 'text/plain;charset=utf-8');
  }
}

function downloadMp3Audio() {
  const videoUrl = window.location.href;
  const rawTitle = document.title.replace('- YouTube', '').trim();
  const videoTitle = encodeURIComponent(rawTitle.replace(/[\\/:*?"<>|]/g, '_') || 'youtube_audio');

  const downloadUrl = `${SERVER_URL}/api/download-mp3?videoUrl=${encodeURIComponent(videoUrl)}&title=${videoTitle}`;

  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `${rawTitle}.mp3`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// 7. 팝업 통신 메시지 수신 (발음 언어 변경 수신 로직 추가)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const container = document.getElementById('ai-subtitle-container');
  const origWrap = document.getElementById('sub-original-wrap');
  const pronWrap = document.getElementById('sub-pronunciation-wrap');
  const transWrap = document.getElementById('sub-translation-wrap');

  if (request.action === 'toggle_subtitle' && container) {
    container.style.display = request.show ? 'block' : 'none';
  } else if (request.action === 'toggle_original' && origWrap) {
    origWrap.style.display = request.show ? 'block' : 'none';
  } else if (request.action === 'toggle_pronunciation' && pronWrap) {
    pronWrap.style.display = request.show ? 'block' : 'none';
  } else if (request.action === 'toggle_translation' && transWrap) {
    transWrap.style.display = request.show ? 'block' : 'none';
  } else if (request.action === 'change_target_lang') {
    // 팝업에서 연음 언어 설정 변경 시 처리
    if (request.targetLang && currentTargetLang !== request.targetLang) {
      currentTargetLang = request.targetLang;
      const pronContainer = document.getElementById('pron-container');
      if (pronContainer) pronContainer.innerText = '(선택한 언어로 발음 재분석 중...)';
      requestVideoProcessing();
    }
  } else if (request.action === 'change_font_size') {
    updateSubtitleFontSize(request.fontSize);
  } else if (request.action === 'change_opacity') {
    updateSubtitleOpacity(request.opacity);
  } else if (request.action === 'download_subtitles') {
    downloadSubtitleFile(request.format);
  } else if (request.action === 'download_mp3') {
    downloadMp3Audio();
  }
});

// 8. 백엔드 자막 분석 요청 (targetLang 함께 전달)
async function requestVideoProcessing() {
  try {
    const videoUrl = window.location.href;
    const res = await fetch(`${SERVER_URL}/api/process-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        videoUrl, 
        targetLang: currentTargetLang 
      })
    });

    const data = await res.json();
    if (data.success && data.subtitles && data.subtitles.length > 0) {
      currentSubtitles = data.subtitles;
    }
  } catch (err) {
    console.error('분석 요청 실패:', err);
  }
}

// 9. 초기화 타이머
const initInterval = setInterval(() => {
  const player = document.querySelector('#movie_player');
  if (player) {
    createSubtitleOverlay();
    startSubtitleSync();
    requestVideoProcessing();
    clearInterval(initInterval);
  }
}, 1000);