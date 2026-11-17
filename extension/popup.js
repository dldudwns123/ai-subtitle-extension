document.addEventListener('DOMContentLoaded', () => {
  const toggleSubtitle = document.getElementById('toggleSubtitle');
  const toggleOriginal = document.getElementById('toggleOriginal');
  const togglePronunciation = document.getElementById('togglePronunciation');
  const toggleTranslation = document.getElementById('toggleTranslation');

  // 신규: 발음 언어 선택 요소
  const targetLangSelect = document.getElementById('targetLangSelect');

  const fontSizeSlider = document.getElementById('fontSizeSlider');
  const fontSizeVal = document.getElementById('fontSizeVal');

  const bgOpacitySlider = document.getElementById('bgOpacitySlider');
  const bgOpacityVal = document.getElementById('bgOpacityVal');

  const downloadMp3Btn = document.getElementById('downloadMp3Btn');
  const downloadSrtBtn = document.getElementById('downloadSrtBtn');
  const downloadTxtBtn = document.getElementById('downloadTxtBtn');

  function sendMessage(action, payload = {}) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action, ...payload });
      }
    });
  }

  // 1. 레이아웃 ON/OFF 토글 이벤트
  if (toggleSubtitle) toggleSubtitle.addEventListener('change', (e) => sendMessage('toggle_subtitle', { show: e.target.checked }));
  if (toggleOriginal) toggleOriginal.addEventListener('change', (e) => sendMessage('toggle_original', { show: e.target.checked }));
  if (togglePronunciation) togglePronunciation.addEventListener('change', (e) => sendMessage('toggle_pronunciation', { show: e.target.checked }));
  if (toggleTranslation) toggleTranslation.addEventListener('change', (e) => sendMessage('toggle_translation', { show: e.target.checked }));

  // 2. 발음 표기 언어 변경 이벤트 ('ko', 'en', 'ja')
  if (targetLangSelect) {
    targetLangSelect.addEventListener('change', (e) => {
      sendMessage('change_target_lang', { targetLang: e.target.value });
    });
  }

  // 3. 자막 크기 조절 슬라이더 이벤트
  if (fontSizeSlider) {
    fontSizeSlider.addEventListener('input', (e) => {
      const size = e.target.value;
      if (fontSizeVal) fontSizeVal.innerText = `${size}px`;
      sendMessage('change_font_size', { fontSize: Number(size) });
    });
  }

  // 4. 배경 투명도 조절 슬라이더 이벤트
  if (bgOpacitySlider) {
    bgOpacitySlider.addEventListener('input', (e) => {
      const opacity = e.target.value;
      if (bgOpacityVal) bgOpacityVal.innerText = `${opacity}%`;
      sendMessage('change_opacity', { opacity: Number(opacity) });
    });
  }

  // 5. 파일 다운로드 이벤트
  if (downloadMp3Btn) downloadMp3Btn.addEventListener('click', () => sendMessage('download_mp3'));
  if (downloadSrtBtn) downloadSrtBtn.addEventListener('click', () => sendMessage('download_subtitles', { format: 'srt' }));
  if (downloadTxtBtn) downloadTxtBtn.addEventListener('click', () => sendMessage('download_subtitles', { format: 'txt' }));
});