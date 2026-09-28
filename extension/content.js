const SERVER_URL = 'http://localhost:5000';
let currentSubtitles = [];
let videoElement = null;

// 자막 오버레이 레이아웃 생성
function createSubtitleOverlay() {
  if (document.getElementById('ai-subtitle-container')) return;

  const container = document.createElement('div');
  container.id = 'ai-subtitle-container';
  container.style.cssText = `
    position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.85); color: #ffffff; padding: 14px 28px;
    border-radius: 12px; text-align: center; z-index: 9999; pointer-events: none;
    box-shadow: 0 4px 15px rgba(0,0,0,0.5); font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
  `;

  // 원문, 한글 발음(글자별 개별 span 태그 구조), 한글 번역 레이어
  container.innerHTML = `
    <style>
      .char-base { color: #ffffff; transition: color 0.1s ease; }
      .char-active { color: #00a2ff; font-weight: bold; } /* 진행 중인 글자 파란색 */
    </style>
    <div id="sub-original-wrap" style="font-size: 24px; font-weight: bold; margin-bottom: 4px; display: inline-block;">
      <span id="orig-base" style="color: #ffffff;">자막 준비 중...</span>
    </div>
    <div id="sub-pronunciation-wrap" style="font-size: 26px; font-weight: 800; display: inline-block; margin-top: 4px; letter-spacing: 1px;">
      <span id="pron-container">(AI 분석 대기 중)</span>
    </div>
    <div id="sub-translation-wrap" style="font-size: 16px; color: #aaaaaa; font-weight: 500; margin-top: 6px;">
      <span id="trans-text"></span>
    </div>
  `;

  const player = document.querySelector('#movie_player') || document.body;
  player.appendChild(container);
}

// 글자별 <span> 분할 생성 함수
function renderPronunciationSpans(text) {
  const container = document.getElementById('pron-container');
  if (!container) return;

  container.innerHTML = '';
  // 문장 내 각 글자를 개별 span 요소로 분할하여 주입
  Array.from(text).forEach((char, index) => {
    const span = document.createElement('span');
    span.innerText = char;
    span.className = 'char-base';
    span.dataset.index = index;
    container.appendChild(span);
  });
}

// 실시간 타임스탬프 기반 글자 단위 정밀 하이라이트 동기화
function startSubtitleSync() {
  videoElement = document.querySelector('video');
  if (!videoElement) return;

  let lastSub = null;

  function updateKaraokeHighlight() {
    if (currentSubtitles.length > 0 && videoElement) {
      const currentTime = videoElement.currentTime;

      // 현재 재생 시간에 해당하는 자막 탐색
      const currentSub = currentSubtitles.find(
        (sub) => currentTime >= sub.start && currentTime <= sub.end
      );

      const origBase = document.getElementById('orig-base');
      const pronContainer = document.getElementById('pron-container');
      const transText = document.getElementById('trans-text');

      if (origBase && pronContainer && transText) {
        if (currentSub) {
          // 구간 대사가 변경되었을 때만 DOM 갱신 (글자 span 새로 생성)
          if (lastSub !== currentSub) {
            lastSub = currentSub;
            origBase.innerText = currentSub.text || '';
            transText.innerText = currentSub.translation || '';
            renderPronunciationSpans(currentSub.pronunciation || '');
          }

          // 재생 진행 비율 및 파란색으로 변할 글자 수 정밀 계산
          const duration = currentSub.end - currentSub.start;
          const elapsed = currentTime - currentSub.start;
          const progress = Math.min(Math.max(elapsed / duration, 0), 1);

          const charSpans = pronContainer.querySelectorAll('span');
          const totalChars = charSpans.length;
          const activeIndex = Math.floor(progress * totalChars);

          // 각 글자의 시간 위치에 맞춰 개별 색상 적용 (위치 어긋남 완벽 방지)
          charSpans.forEach((span, i) => {
            if (i <= activeIndex) {
              span.classList.add('char-active');
            } else {
              span.classList.remove('char-active');
            }
          });
        } else {
          // 해당 시간에 대사가 없는 구간
          lastSub = null;
          origBase.innerText = '';
          pronContainer.innerHTML = '';
          transText.innerText = '';
        }
      }
    }
    requestAnimationFrame(updateKaraokeHighlight);
  }

  updateKaraokeHighlight();
}

// 팝업 ON/OFF 수신 메시지 처리
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const container = document.getElementById('ai-subtitle-container');
  const origWrap = document.getElementById('sub-original-wrap');
  const pronWrap = document.getElementById('sub-pronunciation-wrap');
  const transWrap = document.getElementById('sub-translation-wrap');

  if (request.action === 'toggle_subtitle' && container) {
    container.style.display = request.show ? 'block' : 'none';
  } else if (request.action === 'toggle_original' && origWrap) {
    origWrap.style.display = request.show ? 'inline-block' : 'none';
  } else if (request.action === 'toggle_pronunciation' && pronWrap) {
    pronWrap.style.display = request.show ? 'inline-block' : 'none';
  } else if (request.action === 'toggle_translation' && transWrap) {
    transWrap.style.display = request.show ? 'block' : 'none';
  }
});

// 백엔드 요청
async function requestVideoProcessing() {
  try {
    const videoUrl = window.location.href;
    const res = await fetch(`${SERVER_URL}/api/process-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl })
    });

    const data = await res.json();
    if (data.success && data.subtitles && data.subtitles.length > 0) {
      currentSubtitles = data.subtitles;
    }
  } catch (err) {
    console.error('분석 요청 실패:', err);
  }
}

const initInterval = setInterval(() => {
  const player = document.querySelector('#movie_player');
  if (player) {
    createSubtitleOverlay();
    startSubtitleSync();
    requestVideoProcessing();
    clearInterval(initInterval);
  }
}, 1000);