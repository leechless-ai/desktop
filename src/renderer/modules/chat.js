export function initChatModule({
  bridge,
  elements,
  uiState,
  setBadgeTone,
  appendSystemLog,
}) {
  function formatChatTime(timestamp) {
    const d = new Date(timestamp);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function scrollChatToBottom() {
    const container = elements.chatMessages;
    if (!container) return;
    const threshold = 100;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < threshold) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function renderMarkdown(text) {
    let html = escapeHtml(text);

    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      const langLabel = lang || 'code';
      const codeId = 'code-' + Math.random().toString(36).slice(2, 8);
      return `<div class="chat-code-container"><div class="chat-code-header"><span class="code-lang">${langLabel}</span><button class="chat-code-copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('${codeId}').textContent).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})">Copy</button></div><pre><code id="${codeId}">${code}</code></pre></div>`;
    });

    html = html.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');
    html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:14px;font-weight:600;margin:12px 0 6px;color:var(--text-primary)">$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:16px;font-weight:600;margin:14px 0 8px;color:var(--text-primary)">$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:18px;font-weight:700;margin:16px 0 8px;color:var(--text-primary)">$1</h1>');
    html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:12px 0">');
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--accent-blue);text-decoration:underline" target="_blank" rel="noopener">$1</a>');
    html = html.replace(/^[\-*] (.+)$/gm, '<li style="margin-left:16px;list-style:disc">$1</li>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin-left:16px;list-style:decimal">$1</li>');
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  function renderContentBlocks(blocks) {
    if (!Array.isArray(blocks)) return renderMarkdown(String(blocks));

    const toolIcons = {
      bash: '⚡',
      read_file: '📄',
      write_file: '✏️',
      list_directory: '📁',
      search_files: '🔍',
      grep: '🔎',
    };
    let html = '';

    for (const block of blocks) {
      switch (block.type) {
        case 'text':
          html += `<div class="chat-bubble-content">${renderMarkdown(block.text)}</div>`;
          break;
        case 'thinking':
          html += '<div class="thinking-block">';
          html += '<div class="thinking-block-header" onclick="this.parentElement.classList.toggle(\'open\')">';
          html += '<span class="thinking-block-triangle">▶</span>';
          html += '<span>Reasoning</span>';
          html += '</div>';
          html += `<div class="thinking-block-body">${escapeHtml(block.thinking)}</div>`;
          html += '</div>';
          break;
        case 'tool_use': {
          const icon = toolIcons[block.name] || '🔧';
          const inputJson = JSON.stringify(block.input, null, 2);
          html += `<div class="tool-block" data-tool-id="${escapeHtml(block.id)}">`;
          html += '<div class="tool-block-header" onclick="this.parentElement.classList.toggle(\'open\')">';
          html += '<span class="tool-block-triangle">▶</span>';
          html += `<span class="tool-block-icon">${icon}</span>`;
          html += `<span class="tool-block-name">${escapeHtml(block.name)}</span>`;
          html += '<span class="tool-block-status success">Done</span>';
          html += '</div>';
          html += '<div class="tool-block-body">';
          html += `<div class="tool-block-input">${escapeHtml(inputJson)}</div>`;
          html += '</div></div>';
          break;
        }
        case 'tool_result': {
          const outputText = block.content || '';
          const truncated = outputText.length > 2000 ? outputText.slice(0, 2000) + '\n... (truncated)' : outputText;
          html += '<div class="tool-block">';
          html += '<div class="tool-block-header" onclick="this.parentElement.classList.toggle(\'open\')">';
          html += '<span class="tool-block-triangle">▶</span>';
          html += '<span class="tool-block-icon">📋</span>';
          html += '<span class="tool-block-name">Result</span>';
          html += `<span class="tool-block-status ${block.is_error ? 'error' : 'success'}">${block.is_error ? 'Error' : 'Success'}</span>`;
          html += '</div>';
          html += '<div class="tool-block-body">';
          html += `<div class="tool-block-output${block.is_error ? ' error' : ''}">${escapeHtml(truncated)}</div>`;
          html += '</div></div>';
          break;
        }
      }
    }

    return html;
  }

  async function refreshChatProxyStatus() {
    if (!bridge || !bridge.chatAiGetProxyStatus) return;

    try {
      const result = await bridge.chatAiGetProxyStatus();
      if (result.ok && result.data) {
        const { running, port } = result.data;
        if (running) {
          setBadgeTone(elements.chatProxyStatus, 'active', `Proxy :${port}`);
        } else {
          setBadgeTone(elements.chatProxyStatus, 'idle', 'Proxy offline');
        }
      }
    } catch {
      setBadgeTone(elements.chatProxyStatus, 'idle', 'Proxy offline');
    }
  }

  async function refreshChatConversations() {
    if (!bridge || !bridge.chatAiListConversations) return;

    try {
      const result = await bridge.chatAiListConversations();
      if (result.ok) {
        uiState.chatConversations = result.data || [];
        renderChatConversations();
      }
    } catch {
      // Chat unavailable
    }
  }

  function renderChatConversations() {
    const container = elements.chatConversations;
    if (!container) return;

    const convs = uiState.chatConversations;
    if (convs.length === 0) {
      container.innerHTML = '<div class="chat-empty">No conversations yet</div>';
      return;
    }

    container.innerHTML = '';
    for (const conv of convs) {
      const item = document.createElement('div');
      item.className = `chat-conv-item${conv.id === uiState.chatActiveConversation ? ' active' : ''}`;
      item.dataset.convId = conv.id;

      let html = `<div class="chat-conv-peer">${escapeHtml(conv.title)}</div>`;
      if (conv.updatedAt > 0) {
        html += `<span class="chat-conv-time">${formatChatTime(conv.updatedAt)}</span>`;
      }
      html += `<div class="chat-conv-preview">${conv.messageCount} messages · ${conv.model.split('-').slice(0, 2).join('-')}</div>`;

      item.innerHTML = html;
      item.addEventListener('click', () => {
        void openConversation(conv.id);
      });
      container.appendChild(item);
    }
  }

  async function openConversation(convId) {
    if (!bridge || !bridge.chatAiGetConversation) return;

    uiState.chatActiveConversation = convId;

    try {
      const result = await bridge.chatAiGetConversation(convId);
      if (result.ok && result.data) {
        const conv = result.data;
        uiState.chatMessages = conv.messages || [];

        const header = elements.chatHeader;
        if (header) {
          const peerSpan = header.querySelector('.chat-thread-peer');
          if (peerSpan) peerSpan.textContent = conv.title;
        }

        if (elements.chatDeleteBtn) elements.chatDeleteBtn.style.display = '';
        if (elements.chatModelSelect) elements.chatModelSelect.value = conv.model;
        if (elements.chatInput) elements.chatInput.disabled = false;
        if (elements.chatSendBtn) elements.chatSendBtn.disabled = false;

        renderChatMessages();
        renderChatConversations();
      }
    } catch {
      // Conversation load failed
    }
  }

  function renderChatMessages() {
    const container = elements.chatMessages;
    if (!container) return;

    const msgs = uiState.chatMessages;
    if (msgs.length === 0) {
      container.innerHTML = `
      <div class="chat-welcome">
        <div class="chat-welcome-title">Leechless AI Chat</div>
        <div class="chat-welcome-subtitle">Send messages through the P2P marketplace to inference providers.</div>
        <div class="chat-welcome-subtitle">Start the Buyer runtime and create a new conversation to begin.</div>
      </div>`;
      return;
    }

    container.innerHTML = '';
    for (const msg of msgs) {
      if (msg.role === 'user' && Array.isArray(msg.content) && msg.content.every((b) => b.type === 'tool_result')) {
        continue;
      }

      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${msg.role === 'user' ? 'own' : 'other'}`;

      if (msg.role === 'assistant') {
        if (Array.isArray(msg.content)) {
          bubble.innerHTML = renderContentBlocks(msg.content);
        } else {
          bubble.innerHTML = `<div class="chat-bubble-content">${renderMarkdown(msg.content)}</div>`;
        }
      } else if (typeof msg.content === 'string') {
        bubble.innerHTML = `<div>${escapeHtml(msg.content)}</div>`;
      } else {
        bubble.innerHTML = `<div>${escapeHtml(JSON.stringify(msg.content))}</div>`;
      }

      container.appendChild(bubble);
    }

    container.scrollTop = container.scrollHeight;
  }

  async function createNewConversation() {
    if (!bridge || !bridge.chatAiCreateConversation) return;

    const model = elements.chatModelSelect?.value || 'claude-sonnet-4-20250514';
    try {
      const result = await bridge.chatAiCreateConversation(model);
      if (result.ok && result.data) {
        await refreshChatConversations();
        await openConversation(result.data.id);
      }
    } catch (err) {
      appendSystemLog(`Failed to create conversation: ${err}`);
    }
  }

  async function deleteConversation() {
    const convId = uiState.chatActiveConversation;
    if (!convId || !bridge || !bridge.chatAiDeleteConversation) return;

    try {
      await bridge.chatAiDeleteConversation(convId);
      uiState.chatActiveConversation = null;
      uiState.chatMessages = [];

      if (elements.chatDeleteBtn) elements.chatDeleteBtn.style.display = 'none';
      if (elements.chatInput) elements.chatInput.disabled = true;
      if (elements.chatSendBtn) elements.chatSendBtn.disabled = true;

      const header = elements.chatHeader;
      if (header) {
        const peerSpan = header.querySelector('.chat-thread-peer');
        if (peerSpan) peerSpan.textContent = 'AI Assistant';
      }

      renderChatMessages();
      await refreshChatConversations();
    } catch (err) {
      appendSystemLog(`Failed to delete conversation: ${err}`);
    }
  }

  function setChatSending(sending) {
    uiState.chatSending = sending;
    if (elements.chatInput) elements.chatInput.disabled = sending;
    if (elements.chatSendBtn) {
      elements.chatSendBtn.disabled = sending;
      elements.chatSendBtn.style.display = sending ? 'none' : '';
    }
    if (elements.chatAbortBtn) elements.chatAbortBtn.style.display = sending ? '' : 'none';
    if (elements.chatStreamingIndicator) elements.chatStreamingIndicator.style.display = sending ? '' : 'none';
  }

  async function sendChatMessage() {
    const convId = uiState.chatActiveConversation;
    const input = elements.chatInput;
    if (!convId || !input || !bridge) return;

    const content = input.value.trim();
    if (content.length === 0) return;

    input.value = '';
    autoGrowTextarea(input);

    uiState.chatMessages.push({ role: 'user', content });
    renderChatMessages();

    setChatSending(true);

    try {
      const model = elements.chatModelSelect?.value;
      if (bridge.chatAiSendStream) {
        const result = await bridge.chatAiSendStream(convId, content, model);
        if (!result.ok) {
          appendSystemLog(`Chat error: ${result.error}`);
        }
      } else if (bridge.chatAiSend) {
        const result = await bridge.chatAiSend(convId, content, model);
        if (!result.ok) {
          appendSystemLog(`Chat error: ${result.error}`);
        }
        setChatSending(false);
      }
    } catch (err) {
      appendSystemLog(`Chat send failed: ${err}`);
      setChatSending(false);
    }
  }

  function autoGrowTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  }

  if (elements.chatSendBtn) {
    elements.chatSendBtn.addEventListener('click', () => {
      void sendChatMessage();
    });
  }

  if (elements.chatAbortBtn) {
    elements.chatAbortBtn.addEventListener('click', async () => {
      if (bridge && bridge.chatAiAbort) {
        await bridge.chatAiAbort();
      }
      setChatSending(false);
    });
  }

  if (elements.chatInput) {
    elements.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendChatMessage();
      }
    });
    elements.chatInput.addEventListener('input', () => {
      autoGrowTextarea(elements.chatInput);
    });
  }

  if (elements.chatNewBtn) {
    elements.chatNewBtn.addEventListener('click', () => {
      void createNewConversation();
    });
  }

  if (elements.chatDeleteBtn) {
    elements.chatDeleteBtn.addEventListener('click', () => {
      void deleteConversation();
    });
  }

  if (bridge) {
    if (bridge.onChatAiDone) {
      bridge.onChatAiDone((data) => {
        if (data.conversationId === uiState.chatActiveConversation) {
          uiState.chatMessages.push(data.message);
          renderChatMessages();
          setChatSending(false);
        }
        void refreshChatConversations();
      });
    }

    if (bridge.onChatAiError) {
      bridge.onChatAiError((data) => {
        if (data.conversationId === uiState.chatActiveConversation) {
          setChatSending(false);
          if (data.error !== 'Request aborted') {
            appendSystemLog(`AI Chat error: ${data.error}`);
          }
        }
      });
    }

    let streamingBubble = null;
    let streamingTextBuffer = '';
    let streamingThinkingBuffer = '';

    if (bridge.onChatAiStreamStart) {
      bridge.onChatAiStreamStart((data) => {
        if (data.conversationId !== uiState.chatActiveConversation) return;
        streamingTextBuffer = '';
        streamingThinkingBuffer = '';

        const container = elements.chatMessages;
        if (!container) return;
        streamingBubble = document.createElement('div');
        streamingBubble.className = 'chat-bubble other';
        streamingBubble.innerHTML = '<div class="chat-bubble-content streaming-cursor"></div>';
        container.appendChild(streamingBubble);
        scrollChatToBottom();
      });
    }

    if (bridge.onChatAiStreamBlockStart) {
      bridge.onChatAiStreamBlockStart((data) => {
        if (data.conversationId !== uiState.chatActiveConversation || !streamingBubble) return;

        if (data.blockType === 'text') {
          streamingTextBuffer = '';
        } else if (data.blockType === 'thinking') {
          streamingThinkingBuffer = '';
          const thinkDiv = document.createElement('div');
          thinkDiv.className = 'thinking-block open';
          thinkDiv.id = `stream-think-${data.index}`;
          thinkDiv.innerHTML = '<div class="thinking-block-header" onclick="this.parentElement.classList.toggle(\'open\')"><span class="thinking-block-triangle">▶</span><span>Reasoning...</span></div><div class="thinking-block-body"></div>';
          streamingBubble.appendChild(thinkDiv);
          scrollChatToBottom();
        } else if (data.blockType === 'tool_use') {
          const toolIcons = {
            bash: '⚡',
            read_file: '📄',
            write_file: '✏️',
            list_directory: '📁',
            search_files: '🔍',
            grep: '🔎',
          };
          const icon = toolIcons[data.toolName] || '🔧';
          const toolDiv = document.createElement('div');
          toolDiv.className = 'tool-block';
          toolDiv.id = `stream-tool-${data.toolId}`;
          toolDiv.innerHTML = `<div class="tool-block-header" onclick="this.parentElement.classList.toggle('open')"><span class="tool-block-triangle">▶</span><span class="tool-block-icon">${icon}</span><span class="tool-block-name">${escapeHtml(data.toolName || '')}</span><span class="tool-block-status running"><span class="tool-spinner"></span></span></div><div class="tool-block-body"><div class="tool-block-input">Preparing...</div></div>`;
          streamingBubble.appendChild(toolDiv);
          scrollChatToBottom();
        }
      });
    }

    if (bridge.onChatAiStreamDelta) {
      bridge.onChatAiStreamDelta((data) => {
        if (data.conversationId !== uiState.chatActiveConversation || !streamingBubble) return;

        if (data.blockType === 'text') {
          streamingTextBuffer += data.text;
          const contentEl = streamingBubble.querySelector('.chat-bubble-content');
          if (contentEl) {
            contentEl.innerHTML = renderMarkdown(streamingTextBuffer);
            contentEl.classList.add('streaming-cursor');
          }
          scrollChatToBottom();
        } else if (data.blockType === 'thinking') {
          streamingThinkingBuffer += data.text;
          const thinkBody = streamingBubble.querySelector(`#stream-think-${data.index} .thinking-block-body`);
          if (thinkBody) {
            thinkBody.textContent = streamingThinkingBuffer;
          }
          scrollChatToBottom();
        }
      });
    }

    if (bridge.onChatAiStreamBlockStop) {
      bridge.onChatAiStreamBlockStop((data) => {
        if (data.conversationId !== uiState.chatActiveConversation || !streamingBubble) return;

        if (data.blockType === 'text') {
          const contentEl = streamingBubble.querySelector('.chat-bubble-content');
          if (contentEl) {
            contentEl.classList.remove('streaming-cursor');
            contentEl.innerHTML = renderMarkdown(streamingTextBuffer);
          }
        } else if (data.blockType === 'thinking') {
          const thinkHeader = streamingBubble.querySelector(`#stream-think-${data.index} .thinking-block-header span:last-child`);
          if (thinkHeader) thinkHeader.textContent = 'Reasoning';
          const thinkBlock = streamingBubble.querySelector(`#stream-think-${data.index}`);
          if (thinkBlock) thinkBlock.classList.remove('open');
        } else if (data.blockType === 'tool_use' && data.input) {
          const toolBlock = streamingBubble.querySelector(`#stream-tool-${data.toolId}`);
          if (toolBlock) {
            const inputDiv = toolBlock.querySelector('.tool-block-input');
            if (inputDiv) inputDiv.textContent = JSON.stringify(data.input, null, 2);
          }
        }
      });
    }

    if (bridge.onChatAiToolExecuting) {
      bridge.onChatAiToolExecuting((data) => {
        if (data.conversationId !== uiState.chatActiveConversation || !streamingBubble) return;

        const toolBlock = streamingBubble.querySelector(`#stream-tool-${data.toolUseId}`);
        if (toolBlock) {
          const statusEl = toolBlock.querySelector('.tool-block-status');
          if (statusEl) {
            statusEl.className = 'tool-block-status running';
            statusEl.innerHTML = '<span class="tool-spinner"></span> Running';
          }
          const inputDiv = toolBlock.querySelector('.tool-block-input');
          if (inputDiv) inputDiv.textContent = JSON.stringify(data.input, null, 2);
        }
      });
    }

    if (bridge.onChatAiToolResult) {
      bridge.onChatAiToolResult((data) => {
        if (data.conversationId !== uiState.chatActiveConversation || !streamingBubble) return;

        const toolBlock = streamingBubble.querySelector(`#stream-tool-${data.toolUseId}`);
        if (toolBlock) {
          const statusEl = toolBlock.querySelector('.tool-block-status');
          if (statusEl) {
            statusEl.className = `tool-block-status ${data.isError ? 'error' : 'success'}`;
            statusEl.textContent = data.isError ? 'Error' : 'Done';
          }
          const bodyEl = toolBlock.querySelector('.tool-block-body');
          if (bodyEl) {
            const truncated = data.output.length > 2000 ? data.output.slice(0, 2000) + '\n... (truncated)' : data.output;
            const outputDiv = document.createElement('div');
            outputDiv.className = `tool-block-output${data.isError ? ' error' : ''}`;
            outputDiv.textContent = truncated;
            bodyEl.appendChild(outputDiv);
          }
        }
        scrollChatToBottom();
      });
    }

    if (bridge.onChatAiStreamDone) {
      bridge.onChatAiStreamDone((data) => {
        if (data.conversationId !== uiState.chatActiveConversation) return;

        streamingBubble = null;
        streamingTextBuffer = '';
        streamingThinkingBuffer = '';
        setChatSending(false);

        void openConversation(data.conversationId);
        void refreshChatConversations();
      });
    }

    if (bridge.onChatAiStreamError) {
      bridge.onChatAiStreamError((data) => {
        if (data.conversationId !== uiState.chatActiveConversation) return;

        streamingBubble = null;
        streamingTextBuffer = '';
        streamingThinkingBuffer = '';
        setChatSending(false);

        if (data.error !== 'Request aborted') {
          appendSystemLog(`AI Chat error: ${data.error}`);
        }
      });
    }
  }

  return {
    refreshChatProxyStatus,
    refreshChatConversations,
  };
}
