/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Chat, Content } from '@google/genai';
import { marked } from 'marked';

declare var Prism: {
  highlightElement(element: Element): void;
};

const messageInput = document.getElementById('messageInput') as HTMLTextAreaElement;
const sendButton = document.getElementById('sendButton') as HTMLButtonElement;
const chatContainer = document.getElementById('chatContainer') as HTMLDivElement;
const statusMessage = document.getElementById('statusMessage') as HTMLDivElement;
const clearChatButton = document.getElementById('clearChatButton') as HTMLButtonElement;

if (!messageInput || !sendButton || !chatContainer || !statusMessage || !clearChatButton) {
  throw new Error("Required HTML elements are missing from the DOM.");
}

marked.use({
  mangle: false,
  headerIds: false,
  gfm: true,
  breaks: true,
});

function parseMarkdown(text: string): string {
  try {
    const sanitizedText = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    return marked.parse(sanitizedText) as string;
  } catch (e) {
    console.error("Markdown parsing error:", e);
    return text;
  }
}

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error("API_KEY is not set. Please ensure process.env.API_KEY is available.");
  addMessageToChat({
    id: `err-${Date.now()}`,
    role: 'model',
    isError: true,
    textContent: "Configuration error: API Key is missing. Cannot connect to AI services.",
    timestamp: Date.now()
  });
}
const ai = new GoogleGenAI({ apiKey: API_KEY });
let chat: Chat;

const CHAT_HISTORY_KEY = 'aiChatAssistantProHistory';

interface StoredMessage {
  id: string;
  role: 'user' | 'model';
  textContent?: string;
  imageUrl?: string;
  altText?: string;
  isError?: boolean;
  timestamp: number;
}

function initializeChat(history: Content[] = []) {
  chat = ai.chats.create({
    model: 'gemini-2.5-flash-preview-04-17',
    history: history, // Initialize with past text-based interactions
    config: {
      systemInstruction: "You are 'AI Chat Assistant Pro', a highly versatile AI. Your primary functions are to answer questions, provide detailed explanations, and assist with coding. When asked to write code, you MUST provide the code enclosed in triple backticks (```) followed by the language name (e.g., ```python or ```javascript). Use Markdown formatting (bold: **text**, italics: *text*, lists: - item, inline code: `code`) extensively to enhance readability for all textual responses. If you generate images (user asks with 'generate image of...', 'draw...'), confirm the action then display the image. If unable to fulfill a request, explain why politely. Prioritize accuracy, clarity, and helpfulness.",
    },
  });
}


const IMAGE_GENERATION_KEYWORDS = [
  "generate image of", "create an image of", "draw a picture of", 
  "draw an image of", "show me an image of", "make an image of"
];

sendButton.addEventListener('click', handleSendMessage);
messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSendMessage();
  }
});
clearChatButton.addEventListener('click', confirmClearChat);

function createMessageDiv(message: StoredMessage): HTMLElement {
  const messageDiv = document.createElement('div');
  messageDiv.classList.add('message', `message-${message.role}`);
  messageDiv.setAttribute('data-message-id', message.id);
  if (message.isError) {
    messageDiv.classList.add('message-error');
  }
  return messageDiv;
}

function addMessageToChat(message: StoredMessage, isNew: boolean = true): HTMLElement {
  const messageDiv = createMessageDiv(message);
  
  if (message.textContent) {
    const contentDiv = document.createElement('div');
    contentDiv.className = 'markdown-content';
    if (message.role === 'user' || message.isError) { 
        // User messages and errors are directly set (errors already formatted with markdown)
        contentDiv.innerHTML = message.isError ? parseMarkdown(`**Error:** ${message.textContent}`) : parseMarkdown(message.textContent) ;
    } else { // AI model text content
        contentDiv.innerHTML = parseMarkdown(message.textContent);
    }
    if (message.isError) contentDiv.classList.add('error-text');
    messageDiv.appendChild(contentDiv);
  } else if (message.imageUrl) {
    const imgElement = document.createElement('img');
    imgElement.src = message.imageUrl;
    imgElement.alt = message.altText || "Generated image";
    imgElement.classList.add('generated-image');
    messageDiv.appendChild(imgElement);
  }
  
  chatContainer.appendChild(messageDiv);
  if (isNew) { // Only scroll for new messages, not when loading history
      chatContainer.scrollTop = chatContainer.scrollHeight;
  }
  return messageDiv;
}

function saveMessageToHistory(message: StoredMessage) {
  const history = loadChatHistory();
  history.push(message);
  localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(history));
}

function loadChatHistory(): StoredMessage[] {
  const historyJson = localStorage.getItem(CHAT_HISTORY_KEY);
  return historyJson ? JSON.parse(historyJson) : [];
}

function populateChatFromHistory() {
  const history = loadChatHistory();
  const geminiHistory: Content[] = [];
  history.forEach(msg => {
    addMessageToChat(msg, false); // false for isNew, don't scroll excessively
    // Repopulate Gemini chat history for context (text only)
    if (msg.textContent && !msg.isError) {
      geminiHistory.push({ role: msg.role, parts: [{ text: msg.textContent }] });
    }
  });
  initializeChat(geminiHistory); // Initialize chat with history
  // Scroll to bottom after loading all history
  chatContainer.scrollTop = chatContainer.scrollHeight;
}


async function handleSendMessage() {
  if (!API_KEY) {
    addMessageToChat({
        id: `err-noapikey-${Date.now()}`,
        role: 'model',
        isError: true,
        textContent: "Cannot send message: API Key is not configured.",
        timestamp: Date.now()
      });
    return;
  }
  const userMessageText = messageInput.value.trim();
  if (!userMessageText) return;

  const userMessage: StoredMessage = {
    id: `user-${Date.now()}`,
    role: 'user',
    textContent: userMessageText,
    timestamp: Date.now()
  };
  addMessageToChat(userMessage);
  saveMessageToHistory(userMessage);
  messageInput.value = '';
  adjustTextareaHeight();
  
  const lowerCaseMessage = userMessageText.toLowerCase();
  let isImageRequest = false;
  let imagePrompt = "";

  for (const keyword of IMAGE_GENERATION_KEYWORDS) {
    if (lowerCaseMessage.startsWith(keyword)) {
      isImageRequest = true;
      imagePrompt = userMessageText.substring(keyword.length).trim();
      break;
    }
  }

  setLoading(true, isImageRequest && imagePrompt ? "Generating image..." : "AI is thinking...");

  try {
    if (isImageRequest && imagePrompt) {
      await handleImageGeneration(imagePrompt);
    } else {
      await handleTextMessage(userMessageText);
    }
  } catch (error) {
    console.error('Error handling message:', error);
    const errorMessageContent = error instanceof Error ? error.message : "An unknown error occurred.";
    const errorMsg: StoredMessage = {
      id: `err-handler-${Date.now()}`,
      role: 'model',
      textContent: errorMessageContent,
      isError: true,
      timestamp: Date.now()
    };
    addMessageToChat(errorMsg);
    saveMessageToHistory(errorMsg);
  } finally {
    setLoading(false);
  }
}

async function handleTextMessage(text: string) {
  const thinkingMessageId = `ai-thinking-${Date.now()}`;
  const aiMessageBubble = createMessageDiv({ 
      id: thinkingMessageId, 
      role: 'model', 
      textContent: "<i>AI is thinking...</i>", 
      timestamp: Date.now() 
  });
  const streamingTextElement = document.createElement('div'); 
  streamingTextElement.className = 'markdown-content';
  streamingTextElement.innerHTML = parseMarkdown("<i>AI is thinking...</i>");
  aiMessageBubble.appendChild(streamingTextElement);
  chatContainer.appendChild(aiMessageBubble);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  try {
    const responseStream = await chat.sendMessageStream({ message: text });
    let aiResponseText = "";
    let firstChunkReceived = false;

    for await (const chunk of responseStream) {
      if (!firstChunkReceived) {
        streamingTextElement.innerHTML = ""; 
        firstChunkReceived = true;
      }
      const chunkText = chunk.text;
      if (chunkText) {
        aiResponseText += chunkText;
        streamingTextElement.innerHTML = parseMarkdown(aiResponseText);
      }
    }
    
    // Final processing and saving
    const finalAiMessage: StoredMessage = {
      id: `ai-${Date.now()}`,
      role: 'model',
      textContent: aiResponseText.trim() || "[AI gave an empty response]",
      timestamp: Date.now()
    };
    
    // Replace thinking bubble with final content
    aiMessageBubble.setAttribute('data-message-id', finalAiMessage.id); // Update ID
    aiMessageBubble.innerHTML = ''; // Clear "thinking..."
    formatAndDisplayAIResponse(finalAiMessage.textContent, aiMessageBubble); // Repopulate with formatted content
    saveMessageToHistory(finalAiMessage);

  } catch (error) {
    console.error('Error sending text message:', error);
    const errorMessageContent = error instanceof Error ? error.message : "Could not get a response from the AI.";
    const errorMsg: StoredMessage = {
      id: `err-text-${Date.now()}`,
      role: 'model',
      textContent: errorMessageContent,
      isError: true,
      timestamp: Date.now()
    };
    if (aiMessageBubble && chatContainer.contains(aiMessageBubble)) {
        chatContainer.removeChild(aiMessageBubble); // Remove the thinking bubble
    }
    addMessageToChat(errorMsg); // Add a new error bubble
    saveMessageToHistory(errorMsg);
  }
}

function formatAndDisplayAIResponse(fullText: string, messageDiv: HTMLElement) {
    messageDiv.innerHTML = ''; // Clear previous content (like "thinking...")

    const codeBlockRegex = /```(\w*)\s*\n?([\s\S]*?)\n?\s*```/g;
    let lastIndex = 0;
    let match;
    let contentAdded = false;

    while ((match = codeBlockRegex.exec(fullText)) !== null) {
        if (match.index > lastIndex) {
            const textContent = fullText.substring(lastIndex, match.index).trim();
            if (textContent) {
                 const textDiv = document.createElement('div');
                 textDiv.className = 'markdown-content';
                 textDiv.innerHTML = parseMarkdown(textContent);
                 messageDiv.appendChild(textDiv);
                 contentAdded = true;
            }
        }
        
        const language = match[1]?.trim() || 'plaintext'; 
        const codeContent = match[2].trim();

        if (codeContent) { 
            const pre = document.createElement('pre');
            pre.className = `language-${language}`;
            const code = document.createElement('code');
            code.className = `language-${language}`;
            code.textContent = codeContent;
            pre.appendChild(code);
            
            const copyButton = document.createElement('button');
            copyButton.textContent = 'Copy';
            copyButton.className = 'copy-code-button';
            copyButton.setAttribute('aria-label', 'Copy code to clipboard');
            copyButton.addEventListener('click', () => {
                navigator.clipboard.writeText(codeContent).then(() => {
                    copyButton.textContent = 'Copied!';
                    copyButton.disabled = true;
                    setTimeout(() => {
                        copyButton.textContent = 'Copy';
                        copyButton.disabled = false;
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy code: ', err);
                    // Handle copy error visually
                });
            });
            pre.appendChild(copyButton);
            messageDiv.appendChild(pre);
            
            if (typeof Prism !== 'undefined' && Prism.highlightElement) {
              Prism.highlightElement(code);
            }
            contentAdded = true;
        }
        lastIndex = codeBlockRegex.lastIndex;
    }

    if (lastIndex < fullText.length) {
        const textContent = fullText.substring(lastIndex).trim();
        if (textContent) {
            const textDiv = document.createElement('div');
            textDiv.className = 'markdown-content';
            textDiv.innerHTML = parseMarkdown(textContent);
            messageDiv.appendChild(textDiv);
            contentAdded = true;
        }
    }
    
    if (!contentAdded) { 
        const fallbackDiv = document.createElement('div');
        fallbackDiv.className = 'markdown-content';
        const trimmedFullText = fullText.trim();
        fallbackDiv.innerHTML = parseMarkdown(trimmedFullText === "" ? "<i>[AI gave an empty response]</i>" : trimmedFullText);
        messageDiv.appendChild(fallbackDiv);
    }
    chatContainer.scrollTop = chatContainer.scrollHeight;
}


async function handleImageGeneration(prompt: string) {
  const placeholderId = `ai-img-placeholder-${Date.now()}`;
  const aiMessageBubble = createMessageDiv({ 
      id: placeholderId, 
      role: 'model', 
      textContent: `<i>Generating an image for: "${prompt}"...</i>`, 
      timestamp: Date.now() 
    });
  const infoDiv = document.createElement('div');
  infoDiv.className = 'markdown-content';
  infoDiv.innerHTML = parseMarkdown(`<i>Generating an image for: "${prompt}"...</i>`);
  aiMessageBubble.appendChild(infoDiv);
  chatContainer.appendChild(aiMessageBubble);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  let finalImageMessage: StoredMessage;

  try {
    const response = await ai.models.generateImages({
      model: 'imagen-3.0-generate-002',
      prompt: prompt,
      config: { numberOfImages: 1, outputMimeType: 'image/jpeg' },
    });

    aiMessageBubble.innerHTML = ''; 

    if (response.generatedImages && response.generatedImages[0].image?.imageBytes) {
      const base64ImageBytes = response.generatedImages[0].image.imageBytes;
      const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
      const imgElement = document.createElement('img');
      imgElement.src = imageUrl;
      imgElement.alt = `Generated image for: ${prompt}`;
      imgElement.classList.add('generated-image');
      aiMessageBubble.appendChild(imgElement);

      finalImageMessage = {
        id: `ai-img-${Date.now()}`,
        role: 'model',
        imageUrl: imageUrl,
        altText: `Generated image for: ${prompt}`,
        timestamp: Date.now()
      };
    } else {
      aiMessageBubble.classList.add('message-error');
      const errorText = 'Sorry, I could not generate an image. The image data might be missing.';
      const errorDiv = document.createElement('div');
      errorDiv.className = 'markdown-content error-text';
      errorDiv.innerHTML = parseMarkdown(errorText);
      aiMessageBubble.appendChild(errorDiv);
      finalImageMessage = {
        id: `err-img-${Date.now()}`,
        role: 'model',
        textContent: errorText,
        isError: true,
        timestamp: Date.now()
      };
    }
  } catch (error) {
    console.error('Error generating image:', error);
    aiMessageBubble.innerHTML = ''; 
    aiMessageBubble.classList.add('message-error');
    const errorMessageContent = error instanceof Error ? error.message : "Failed to generate image.";
    const errorDiv = document.createElement('div');
    errorDiv.className = 'markdown-content error-text';
    errorDiv.innerHTML = parseMarkdown(`Error generating image: ${errorMessageContent}`);
    aiMessageBubble.appendChild(errorDiv);
    finalImageMessage = {
      id: `err-img-api-${Date.now()}`,
      role: 'model',
      textContent: `Error generating image: ${errorMessageContent}`,
      isError: true,
      timestamp: Date.now()
    };
  }
  aiMessageBubble.setAttribute('data-message-id', finalImageMessage.id); // Update ID for storage
  saveMessageToHistory(finalImageMessage);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function setLoading(isLoading: boolean, message: string = "") {
  sendButton.disabled = isLoading;
  messageInput.disabled = isLoading;
  if (isLoading) {
    statusMessage.textContent = message;
    statusMessage.style.display = 'block';
    sendButton.setAttribute('aria-busy', 'true');
    messageInput.setAttribute('aria-busy', 'true');
  } else {
    statusMessage.textContent = '';
    statusMessage.style.display = 'none';
    sendButton.removeAttribute('aria-busy');
    messageInput.removeAttribute('aria-busy');
    messageInput.focus();
  }
}

function confirmClearChat() {
  if (confirm("Are you sure you want to clear the entire chat history? This cannot be undone.")) {
    clearChat();
  }
}

function clearChat() {
  chatContainer.innerHTML = ''; // Clear UI
  localStorage.removeItem(CHAT_HISTORY_KEY); // Clear storage
  initializeChat(); // Reset AI chat session (with empty history)
  addMessageToChat({ // Optional: Add a system message indicating chat cleared
    id: `sys-${Date.now()}`,
    role: 'model',
    textContent: "<i>Chat history cleared.</i>",
    timestamp: Date.now()
  }); 
}

// Auto-adjust textarea height
messageInput.addEventListener('input', adjustTextareaHeight);

function adjustTextareaHeight() {
    messageInput.style.height = 'auto'; // Temporarily shrink
    let scrollHeight = messageInput.scrollHeight;
    const maxHeight = parseInt(window.getComputedStyle(messageInput).maxHeight, 10);
    
    if (scrollHeight > maxHeight) {
        messageInput.style.height = maxHeight + 'px';
        messageInput.style.overflowY = 'auto'; // Show scrollbar if content exceeds max-height
    } else {
        messageInput.style.height = scrollHeight + 'px';
        messageInput.style.overflowY = 'hidden'; // Hide scrollbar if content is within bounds
    }
}


// Load history and initialize chat on page load
populateChatFromHistory();
adjustTextareaHeight(); // Initial adjustment
