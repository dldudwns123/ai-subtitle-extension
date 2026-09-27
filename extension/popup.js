document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggleSubtitle');

  toggleBtn.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    
    // 현재 활성화된 탭으로 메세지 전송
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'toggle_subtitle',
          show: isChecked
        });
      }
    });
  });
});