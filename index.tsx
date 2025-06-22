/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Chat } from '@google/genai';

// Declare Prism as a global variable for TypeScript
declare var Prism: {
  highlightElement(element: Element): void;
};

const messageInput = document.getElementById('messageInput') as HTMLTextAreaElement;
const sendButton = document.getElementById('sendButton') as HTMLButtonElement;
const chatContainer = document.getElementById('chatContainer') as HTMLDivElement;
const statusMessage = document.getElementById('statusMessage') as HTMLDivElement;

if (!messageInput || !sendButton || !chatContainer || !statusMessage) {
  throw new Error("Required HTML elements are missing from the DOM.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const chat: Chat = ai.chats.create({
  model: 'gemini-2.5-flash-preview-04-17',
  config: {
    systemInstruction: "You are a versatile AI assistant. Your primary functions are to answer questions, provide explanations, and help with coding. When asked to write code, you MUST provide the code enclosed in triple backticks (```) followed by the language name (e.g., ```python or ```javascript). Any explanations or surrounding text should be outside these code blocks. You can also generate images if a user asks using phrases like 'generate image of...' or 'draw a picture of...'. If generating an image, just show the image. If you cannot fulfill a request, explain why, but prioritize fulfilling coding requests accurately and clearly.",
  },
});

const IMAGE_GENERATION_KEYWORDS = [
  "generate image of",
  "create an image of",
  "draw a picture of",
  "draw an image of",
  "show me an image of",
];

sendButton.addEventListener('click', handleSendMessage);
messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSendMessage();
  }
});

function createMessageBubble(sender: 'user' | 'ai', isError: boolean = false): HTMLElement {
  const messageDiv = document.createElement('div');
  messageDiv.classList.add('message', `message-${sender}`);
  if (isError) {
    messageDiv.classList.add('message-error');
  }
  chatContainer.appendChild(messageDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return messageDiv;
}

function addMessageToChat(content: string | HTMLElement, sender: 'user' | 'ai', isError: boolean = false): HTMLElement {
  const messageDiv = createMessageBubble(sender, isError);
  
  if (typeof content === 'string') {
    const p = document.createElement('p');
    p.textContent = content;
    if (isError) {
        p.classList.add('error-text');
    }
    messageDiv.appendChild(p);
  } else {
    messageDiv.appendChild(content); 
  }
  
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return messageDiv;
}


async function handleSendMessage() {
  const userMessageText = messageInput.value.trim();
  if (!userMessageText) return;

  addMessageToChat(userMessageText, 'user');
  messageInput.value = '';
  
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
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
    const errorBubble = createMessageBubble('ai', true);
    const errorP = document.createElement('p');
    errorP.classList.add('error-text');
    errorP.textContent = `Error: ${errorMessage}`;
    errorBubble.appendChild(errorP);

  } finally {
    setLoading(false);
  }
}

async function handleTextMessage(text: string) {
  const aiMessageBubble = createMessageBubble('ai');
  const streamingTextElement = document.createElement('div'); 
  aiMessageBubble.appendChild(streamingTextElement);
  streamingTextElement.innerHTML = "<p><i>AI is thinking...</i></p>"; 

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
        streamingTextElement.innerHTML = aiResponseText.replace(/\n/g, '<br>'); 
      }
    }
    
    if (!firstChunkReceived && aiMessageBubble.contains(streamingTextElement)) {
        streamingTextElement.innerHTML = ""; 
    }
    formatAndDisplayAIResponse(aiResponseText, aiMessageBubble, streamingTextElement);

  } catch (error) {
    console.error('Error sending text message:', error);
    if (aiMessageBubble) { 
        aiMessageBubble.innerHTML = ''; 
        aiMessageBubble.classList.add('message-error');
        const errorP = document.createElement('p');
        errorP.classList.add('error-text');
        const errorMessageContent = error instanceof Error ? error.message : "Could not get a response from the AI.";
        errorP.textContent = `Error: ${errorMessageContent}`;
        aiMessageBubble.appendChild(errorP);
    }
  }
}

function formatAndDisplayAIResponse(fullText: string, messageDiv: HTMLElement, tempTextElement: HTMLElement | null) {
    if (tempTextElement && messageDiv.contains(tempTextElement)) {
        messageDiv.removeChild(tempTextElement);
    } else {
      messageDiv.innerHTML = '';
    }

    const codeBlockRegex = /```(\w*)\s*\n?([\s\S]*?)\n?\s*```/g;
    let lastIndex = 0;
    let match;
    let contentAdded = false;

    while ((match = codeBlockRegex.exec(fullText)) !== null) {
        if (match.index > lastIndex) {
            const textContent = fullText.substring(lastIndex, match.index).trim();
            if (textContent) {
                 const p = document.createElement('p');
                 p.textContent = textContent;
                 messageDiv.appendChild(p);
                 contentAdded = true;
            }
        }
        
        const language = match[1]?.trim() || 'plaintext'; 
        const codeContent = match[2].trim();

        if (codeContent) { 
            const pre = document.createElement('pre');
            pre.className = `language-${language}`;
            pre.style.position = 'relative'; // For positioning the copy button

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
                    // Optionally, provide visual feedback for error
                    const originalText = copyButton.textContent;
                    copyButton.textContent = 'Error';
                    setTimeout(() => {
                        copyButton.textContent = originalText;
                    }, 2000);
                });
            });
            pre.appendChild(copyButton);
            messageDiv.appendChild(pre);
            
            if (typeof Prism !== 'undefined') {
              Prism.highlightElement(code);
            }
            contentAdded = true;
        }
        lastIndex = codeBlockRegex.lastIndex;
    }

    if (lastIndex < fullText.length) {
        const textContent = fullText.substring(lastIndex).trim();
        if (textContent) {
            const p = document.createElement('p');
            p.textContent = textContent;
            messageDiv.appendChild(p);
            contentAdded = true;
        }
    }
    
    if (!contentAdded) { 
        const fallbackP = document.createElement('p');
        const trimmedFullText = fullText.trim();
        if (trimmedFullText === "") {
            fallbackP.textContent = "[AI gave an empty response]";
            fallbackP.style.fontStyle = "italic";
        } else {
            fallbackP.textContent = trimmedFullText;
        }
        messageDiv.appendChild(fallbackP);
    }
    chatContainer.scrollTop = chatContainer.scrollHeight;
}


async function handleImageGeneration(prompt: string) {
  const aiMessageBubble = createMessageBubble('ai');
  const infoP = document.createElement('p');
  infoP.innerHTML = `<i>Generating an image for: "${prompt}"...</i>`;
  aiMessageBubble.appendChild(infoP);

  try {
    const response = await ai.models.generateImages({
      model: 'imagen-3.0-generate-002',
      prompt: prompt,
      config: { numberOfImages: 1, outputMimeType: 'image/jpeg' },
    });

    aiMessageBubble.innerHTML = ''; 

    if (response.generatedImages && response.generatedImages.length > 0 && response.generatedImages[0].image?.imageBytes) {
      const base64ImageBytes = response.generatedImages[0].image.imageBytes;
      const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
      const imgElement = document.createElement('img');
      imgElement.src = imageUrl;
      imgElement.alt = `Generated image for: ${prompt}`;
      imgElement.classList.add('generated-image');
      aiMessageBubble.appendChild(imgElement);
    } else {
      aiMessageBubble.classList.add('message-error');
      const errorP = document.createElement('p');
      errorP.classList.add('error-text');
      errorP.textContent = 'Sorry, I could not generate an image for that prompt. The image data might be missing or the format is incorrect.';
      aiMessageBubble.appendChild(errorP);
    }
  } catch (error) {
    console.error('Error generating image:', error);
    aiMessageBubble.innerHTML = ''; 
    aiMessageBubble.classList.add('message-error');
    const errorP = document.createElement('p');
    errorP.classList.add('error-text');
    const errorMessage = error instanceof Error ? error.message : "Failed to generate image.";
    errorP.textContent = `Error generating image: ${errorMessage}`;
    aiMessageBubble.appendChild(errorP);
  }
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