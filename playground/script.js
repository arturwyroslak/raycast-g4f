const apiSelect = document.getElementById('apiSelect');
const inputArea = document.getElementById('inputArea');
const submitBtn = document.getElementById('submitBtn');
const outputArea = document.getElementById('outputArea');

// Fetch API list from providers.js
fetch('/src/api/providers.js')
  .then(response => response.text())
  .then(script => {
    //This is a hacky way to extract the API list.  A better solution would be to create a dedicated API endpoint.
    const providersInfoRegex = /export const providers_info = ({[\s\S]*?});/;
    const match = script.match(providersInfoRegex);
    if (match) {
      const providersInfo = eval(`(${match[1]})`);
      const apis = Object.keys(providersInfo);
      apis.forEach(api => {
        const option = document.createElement('option');
        option.value = api;
        option.text = api;
        apiSelect.appendChild(option);
      });
    } else {
      console.error("Could not extract API list from providers.js");
    }
  })
  .catch(error => console.error("Error fetching providers.js:", error));


submitBtn.addEventListener('click', async () => {
  const selectedApi = apiSelect.value;
  const prompt = inputArea.value;
  outputArea.textContent = 'Processing...';

  try {
    const providerInfo = providers_info[selectedApi];
    if (!providerInfo) {
      outputArea.textContent = `Error: Provider "${selectedApi}" not found.`;
      return;
    }

    const provider = providerInfo.provider;
    const model = providerInfo.model;
    const stream = providerInfo.stream;
    const options = providerInfo.options || {}; // Handle additional options if available

    const messages = [{ role: "user", content: prompt }]; // Simple message structure

    let response = "";
    if (stream) {
      const streamUpdate = (chunk) => {
        response += chunk;
        outputArea.textContent = response;
      };
      await provider.generate(messages, { stream: true, ...options }, { stream_update: streamUpdate });
    } else {
      response = await provider.generate(messages, { stream: false, ...options });
      outputArea.textContent = response;
    }
  } catch (error) {
    outputArea.textContent = `Error: ${error.message}`;
    console.error("API call failed:", error);
  }
});

//This is a hacky way to extract the API list.  A better solution would be to create a dedicated API endpoint.
const providersInfoRegex = /export const providers_info = ({[\s\S]*?});/;
const providers_info = {}; // Initialize providers_info here
