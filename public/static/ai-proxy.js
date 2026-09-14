/* Secure AI bridge: the Gemini key stays in the Cloudflare Worker secret. */
(function () {
  // Remove any legacy browser-stored Gemini key from older versions.
  try {
    if (typeof state !== 'undefined' && state.settings) {
      state.settings.geminiApiKey = '';
      if (typeof saveState === 'function') saveState();
    }
  } catch (_) {}

  window.sendChatMessage = async function sendChatMessage() {
    const ta = document.getElementById('chat-input');
    const text = ta?.value.trim();
    if (!text) return;

    state.chatHistory.push({ role: 'user', text });
    saveState();
    ta.value = '';
    ta.style.height = 'auto';
    renderAssistant();

    const scrollEl = document.getElementById('chat-scroll');
    const typingEl = document.createElement('div');
    typingEl.className = 'msg-bubble msg-ai flex items-center gap-1.5';
    typingEl.id = 'typing-indicator';
    typingEl.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    scrollEl.appendChild(typingEl);
    scrollEl.scrollTop = scrollEl.scrollHeight;

    const sendBtn = document.getElementById('chat-send-btn');
    if (sendBtn) sendBtn.disabled = true;

    try {
      const messages = state.chatHistory.slice(-16).map((m) => ({
        role: m.role === 'model' ? 'model' : 'user',
        content: m.text,
      }));

      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: buildSystemContext(),
          messages,
        }),
      });

      const data = await res.json();
      document.getElementById('typing-indicator')?.remove();

      if (!res.ok) {
        const message = data?.error?.message || `Request failed (${res.status})`;
        throw new Error(message);
      }

      const replyText = data?.text || `Apologies, ${HONORIFIC}, I couldn't generate a response. Please try again.`;
      state.chatHistory.push({ role: 'model', text: replyText });
      saveState();
      renderAssistant();
    } catch (err) {
      document.getElementById('typing-indicator')?.remove();
      console.error(err);
      state.chatHistory.push({
        role: 'model',
        text: `Sorry, ${HONORIFIC} — I ran into an error reaching the AI service: ${err.message}.`,
      });
      saveState();
      renderAssistant();
      toast('AI request failed.', 'error');
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  };

  // The old Settings page asked for a browser API key. Replace it with a
  // simple server-side connection status so the secret is never exposed.
  const originalRenderSettings = window.renderSettings;
  window.renderSettings = function renderSecureSettings() {
    originalRenderSettings();
    const keyCard = document.getElementById('api-key-input')?.closest('.glass-card');
    if (!keyCard) return;
    keyCard.innerHTML = `
      <h3 class="section-title text-base flex items-center gap-2"><i class="fa-solid fa-shield-halved text-accent"></i>Gemini Connection</h3>
      <p class="text-[13px] text-slate-400">Gemini is connected through the Cloudflare Worker. Your API key is stored as a server-side secret and is never exposed to the browser.</p>
      <div class="flex items-center gap-2 text-sm text-emerald-400">
        <i class="fa-solid fa-circle-check"></i>
        <span>Secure server-side configuration</span>
      </div>
    `;
  };
})();
