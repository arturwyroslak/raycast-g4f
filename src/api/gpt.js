// This file contains the core logic for interacting with GPT models, adapted from gpt.jsx

import * as providers from "./providers";
import { Message, pairs_to_messages } from "../classes/message";
import { truncate_chat } from "../helpers/helper";
import { plainTextMarkdown } from "../helpers/markdown";
import { formatWebResult, getWebResult, systemResponse, web_search_mode, webSystemPrompt } from "./tools/web";
import { NexraProvider } from "./Providers/nexra";
import { stdin, stdout } from 'process';
import * as readline from 'readline';

let generationStatus = { stop: false, loading: false };
let get_status = () => generationStatus.stop;

// Function to simulate Raycast's showToast
const showToast = async (style, title, message = "") => {
  console.log(`${title}: ${message}`);
};

// Function to simulate Raycast's getSelectedText
const getSelectedText = async () => {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    rl.question('Enter selected text: ', (text) => {
      rl.close();
      resolve(text);
    });
  });
};

// Function to simulate Raycast's confirmAlert
const confirmAlert = async (title, message) => {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    rl.question(`${title}: ${message} (y/n) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
};

// Function to simulate Raycast's launchCommand
const launchCommand = async (command) => {
  console.log(`Launching command: ${command.name}`);
};

// Function to simulate Raycast's popToRoot
const popToRoot = async () => {
  console.log("Popping to root");
};

// Function to simulate Raycast's getPreferenceValues
const getPreferenceValues = () => {
  // Replace with actual preference retrieval logic
  return {
    defaultLanguage: "English",
    useCursorIcon: true,
  };
};

// Input parameters: query - string, files - array of strings (file paths).
const getResponse = async (query, { regenerate = false, files = [] } = {}) => {
  // This is a workaround for multiple generation calls - see the comment above the useEffect.
  if (generationStatus.loading) return;
  generationStatus.loading = true;

  // load provider and model
  const providerString = providers.default_provider_string();
  const info = providers.get_provider_info(providerString);
  // additional options
  let options = providers.get_options_from_info(info);

  let messages = [];

  // Modify the query before sending it to the API
  if (!regenerate) {
    // handle files: we combine files (files that the user uploads)
    // with defaultFiles (files that are passed as a parameter and are always included)
    files = [...files];

    // handle default language
    if (getPreferenceValues().defaultLanguage !== "English") {
      query = `The default language is ${getPreferenceValues().defaultLanguage}. Respond in this language.\n\n${query}`;
    }

    // handle web search
    if (web_search_mode("gpt", info.provider)) {
      // push system prompt
      messages = [
        new Message({ role: "user", content: webSystemPrompt }),
        new Message({ role: "assistant", content: systemResponse }),
        ...messages,
      ];

      // get web search results
      let webResults = await getWebResult(query);
      query = query + formatWebResult(webResults, query);
    }
  }

  await showToast("animated", "Response loading");

  try {
    console.log(query);
    messages = [...messages, new Message({ role: "user", content: query, files: files })];

    // generate response
    let response = "";
    let elapsed = 0.001,
      chars,
      charPerSec;
    let start = Date.now();

    if (!info.stream) {
      response = await chatCompletion(info, messages, options);

      elapsed = (Date.now() - start) / 1000;
      chars = response.length;
      charPerSec = (chars / elapsed).toFixed(1);
    } else {
      let loadingToast = await showToast("animated", "Response loading");
      generationStatus.stop = false;

      const handler = (new_message) => {
        response = new_message;
        response = formatResponse(response, info.provider);

        elapsed = (Date.now() - start) / 1000;
        chars = response.length;
        charPerSec = (chars / elapsed).toFixed(1);
        loadingToast.message = `${chars} chars (${charPerSec} / sec) | ${elapsed.toFixed(1)} sec`;
      };

      await chatCompletion(info, messages, options, handler, get_status);
    }

    await showToast(
      "success",
      "Response finished",
      `${chars} chars (${charPerSec} / sec) | ${elapsed.toFixed(1)} sec`
    );

    // functions that run periodically
  } catch (e) {
    console.log(e);

    await showToast("failure", "Response failed");
  }

  generationStatus.loading = false;
  return response;
};

// Generate response using a chat context (array of Messages, NOT MessagePairs - conversion should be done before this)
// and options. This is the core function of the extension.
//
// if stream_update is passed, we will call it with stream_update(new_message) every time a chunk is received
// otherwise, this function returns an async generator (if stream = true) or a string (if stream = false)
// if status is passed, we will stop generating when status() is true
//
// also note that the chat parameter is an array of Message objects, and how it is handled is up to the provider modules.
// for most providers it is first converted into JSON format before being used.
export const chatCompletion = async (info, chat, options, stream_update = null, status = null) => {
  const provider = info.provider; // provider object
  // additional options
  options = providers.get_options_from_info(info, options);

  let response = await providers.generate(provider, chat, options, { stream_update });

  // stream = false
  if (typeof response === "string") {
    // will not be a string if stream is enabled
    response = formatResponse(response, provider);
    return response;
  }

  // streaming related handling
  if (provider.customStream) return; // handled in the provider
  if (stream_update) {
    await processStream(response, provider, stream_update, status);
    return;
  }
  return response;
};

// generate response. input: currentChat is a chat object from AI Chat; query (string) is optional
// see the documentation of chatCompletion for details on the other parameters
export const getChatResponse = async (currentChat, query = null, stream_update = null, status = null) => {
  // load provider and model
  const info = providers.get_provider_info(currentChat.provider);
  // additional options
  let options = providers.get_options_from_info(info, currentChat.options);

  // format chat
  let chat = pairs_to_messages(currentChat.messages, query);
  chat = truncate_chat(chat, info);

  // generate response
  return await chatCompletion(info, chat, options, stream_update, status);
};

// generate response using a chat context and a query, while forcing stream = false
export const getChatResponseSync = async (currentChat, query = null) => {
  let r = await getChatResponse(currentChat, query);
  if (typeof r === "string") {
    return r;
  }

  const info = providers.get_provider_info(currentChat.provider);
  let response = "";
  for await (const chunk of processChunks(r, info.provider)) {
    response = chunk;
  }
  response = formatResponse(response, info.provider);
  return response;
};

// format response using some heuristics
export const formatResponse = (response, provider = null) => {
  // eslint-disable-next-line no-constant-condition
  if (false && (provider.name === "Nexra" || provider.name === "BestIM")) {
    // replace escape characters: \n with a real newline, \t with a real tab, etc.
    response = response.replace(/\\n/g, "\n");
    response = response.replace(/\\t/g, "\t");
    response = response.replace(/\\r/g, "\r");
    response = response.replace(/\\'/g, "'");
    response = response.replace(/\\"/g, '"');

    // remove all remaining backslashes
    response = response.replace(/\\/g, "");

    // remove <sup>, </sup> tags (not supported apparently)
    response = response.replace(/<sup>/g, "");
    response = response.replace(/<\/sup>/g, "");
  }

  if (provider.name === "Blackbox") {
    // remove version number - example: remove $@$v=v1.13$@$ or $@$v=undefined%@$
    response = response.replace(/\$@\$v=.{1,30}\$@\$/, "");

    // remove sources - the chunk of text starting with $~~~$[ and ending with ]$~~~$
    // as well as everything before it
    const regex = /\$~~~\$\[[^]*]\$~~~\$/;
    let match = response.match(regex);
    if (match) {
      response = response.substring(match.index + match[0].length);
    }
  }

  return response;
};

// yield chunks incrementally from a response.
export const processChunksIncrementalAsync = async function* (response, provider) {
  // default case. response must be an async generator.
  yield* response;
};

export const processChunksIncremental = async function* (response, provider, status = null) {
  // same as processChunksIncrementalAsync, but stops generating as soon as status() is true
  // update every few chunks to reduce performance impact
  let i = 0;
  for await (const chunk of await processChunksIncrementalAsync(response, provider)) {
    if ((i & 15) === 0 && status && status()) break;
    yield chunk;
    i++;
  }
};

// instead of yielding incrementally, this function yields the entire response each time.
// this allows us to perform more complex operations on the response, such as adding a cursor icon.
// hence, when using the function, we will do `response = chunk` instead of `response += chunk`
export const processChunks = async function* (response, provider, status = null) {
  let r = "";

  // Experimental feature: Show a cursor icon while loading the response
  const useCursorIcon = getPreferenceValues().useCursorIcon;
  const cursorIcon = " ●"; // const cursorIcon = "▋";

  for await (const chunk of await processChunksIncremental(response, provider, status)) {
    if (useCursorIcon) {
      // remove cursor icon if enabled
      r = r.slice(0, -cursorIcon.length);
    }

    // normally we add the chunk to r, but for certain providers, the chunk is already yielded fully
    if (provider === NexraProvider) {
      r = chunk;
    } else {
      r += chunk;
    }

    if (useCursorIcon) {
      r += cursorIcon;
    }

    yield r;
  }

  if (useCursorIcon) {
    // remove cursor icon after response is finished
    r = r.slice(0, -cursorIcon.length);
    yield r;
  }
};

// a simple stream handler. upon each chunk received, we call stream_update(new_message)
export const processStream = async function (asyncGenerator, provider, stream_update, status = null) {
  for await (const new_message of processChunks(asyncGenerator, provider, status)) {
    stream_update(new_message);
  }
};
