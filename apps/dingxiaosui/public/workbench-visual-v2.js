(() => {
  const portal = document.querySelector('.media-mascot-portal');
  portal?.addEventListener('click', () => {
    const panel = document.querySelector('.ding-chat-panel');
    if (panel?.hidden) document.querySelector('.ding-chat-launch')?.click();
    else document.querySelector('#ding-chat-input')?.focus();
  });
})();
