// This file contains the core logic for AI interaction and text processing, extracted from aiChat.jsx

import { Storage } from "./api/storage";
import { MessagePair, format_chat_to_prompt, pairs_to_messages } from "./classes/message";
import { formatResponse, getChatResponse, getChatResponseSync } from "./api/gpt";
import * as providers from "./api/providers";
import { getAIPresets, getPreset } from "./helpers/presets";
import { formatWebResult, getWebResult, has_native_web_search, web_search_mode } from "./api/tools/web";
import { webSystemPrompt, systemResponse, webToken, webTokenEnd } from "./api/tools/web";

let generationStatus = { stop: false, loading: false, updateCurrentResponse: false };
let get_status = () => generationStatus.stop;

// Function to format chat for sending to AI
export const formatChatForAI = (messages, systemPrompt, provider, webSearch) => {
  let formattedMessages = [];

  provider = provider instanceof Object ? provider : providers.get_provider_info(provider).provider;

  // Web Search system prompt
  if (webSearch === "always" || (webSearch === "auto" && !has_native_web_search(provider))) {
    systemPrompt += "\n\n" + webSystemPrompt;
  }

  if (systemPrompt) {
    formattedMessages.push(
      new MessagePair({
        prompt: systemPrompt,
        answer: systemResponse,
        visible: false,
      })
    );
  }

  formattedMessages.push(...messages);
  return formattedMessages;
};

// Function to send a message to the AI and get a response
export const sendMessageToAI = async (
  messages,
  provider,
  systemPrompt = "",
  webSearch = "off",
  options = { creativity: "0.7" }
) => {
  const formattedChat = formatChatForAI(messages, systemPrompt, provider, webSearch);
  const response = await getChatResponse(
    { messages: formattedChat, provider, options },
    messages[messages.length - 1].prompt
  );
  return response;
};

// Other functions related to AI interaction and text processing can be added here as needed
