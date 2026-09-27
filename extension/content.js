const SERVER_URL = 'http://localhost:5000';
let currentSubtitles = [];
let videoElement = null;

function createSubtitleOverlay() {
  if (document.getElementById('ai-subtitle-container')) return;

  const container = document.createElement('div');
  container.id = 'ai-subtitle-container';
  container.style.cssText = `
    position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.85); color: #fff; padding: 12px 24px;
    border-radius: 10px; text-align: center; z-index: 9999; pointer-events: none;
  `;

  container.innerHTML = `
    <div id="sub-original" style="font-size: 22px; font-weight: bold; margin-bottom: 4px;">자막 생성 중...</div>
    <div id="sub-pronunciation" style="font-size: 16px; color: #ffeb3b;">(AI 분석 중입니다)</div>
  `;

  const player = document.querySelector('#movie_player') || document.body;
  player.appendChild(container);
}

// 비디오 현재 시간에 따른 자막 동기화
// 영상 시간에 맞춘 정밀 자막 동기화
function startSubtitleSync() {
  videoElement = document.querySelector('video');
  if (!videoElement) return;

  // 실시간 타이머로 정밀 오프셋 동기화 (requestAnimationFrame 사용)
  function updateSubtitle() {
    if (currentSubtitles.length > 0 && videoElement) {
      const currentTime = videoElement.currentTime;

      // 현재 시간에 해당하는 자막 찾기
      const currentSub = currentSubtitles.find(
        (sub) => currentTime >= sub.start && currentTime <= sub.end
      );

      const origEl = document.getElementById('sub-original');
      const pronEl = document.getElementById('sub-pronunciation');

      if (origEl && pronEl) {
        if (currentSub) {
          origEl.innerText = currentSub.text;
          pronEl.innerText = currentSub.pronunciation;
        } else {
          // 해당 시간에 자막이 없을 때 화면 초기화
          origEl.innerText = '';
          pronEl.innerText = '';
        }
      }
    }
    requestAnimationFrame(updateSubtitle);
  }

  updateSubtitle();
}

// 서버에 음원 분석 요청
async function requestVideoProcessing() {
  try {
    const videoUrl = window.location.href;
    const res = await fetch(`${SERVER_URL}/api/process-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl })
    });

    const data = await res.json();
    if (data.success) {
      currentSubtitles = data.subtitles;
      console.log('AI 자막 로드 완료:', currentSubtitles);
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