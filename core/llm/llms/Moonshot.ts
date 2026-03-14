import { streamSse } from "@continuedev/fetch";
import { ChatMessage, CompletionOptions, LLMOptions, PromptTemplate } from "../../index.js";
import { osModelsEditPrompt } from "../templates/edit.js";

import OpenAI from "./OpenAI.js";

const kimiEditPrompt: PromptTemplate = (history: ChatMessage[], otherData: Record<string, string>) => {
  return [
    {
      role: "user",
      content: `Edit the following code:
\`\`\`python
def hello():
    print("hello")
\`\`\`
Request: add a name parameter`,
    },
    {
      role: "assistant",
      content: `def hello(name):
    print(f"hello {name}")`,
    },
    {
      role: "user",
      content: `Edit the following code:
\`\`\`${otherData.language}
${otherData.codeToEdit}
\`\`\`
Request: ${otherData.userInput}`,
    },
  ];
};

class Moonshot extends OpenAI {
  static providerName = "moonshot";
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "https://api.moonshot.cn/v1/",
    model: "moonshot-v1-8k",
    promptTemplates: {
      edit: kimiEditPrompt,
    },
    useLegacyCompletionsEndpoint: false,
  };
  maxStopWords: number | undefined = 16;

  supportsFim(): boolean {
    return true;
  }

  async *_streamFim(
    prefix: string,
    suffix: string,
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<string> {
    const endpoint = this._getEndpoint("chat/completions");
    const resp = await this.fetch(endpoint, {
      method: "POST",
      body: JSON.stringify({
        model: options.model,
        messages: [
          {
            role: "user",
            content: prefix + "[fill]" + suffix,
          },
        ],
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        top_p: options.topP,
        frequency_penalty: options.frequencyPenalty,
        presence_penalty: options.presencePenalty,
        stop: options.stop,
        stream: true,
      }),
      headers: this._getHeaders(),
      signal,
    });
    for await (const chunk of streamSse(resp)) {
      yield chunk.choices[0].delta.content;
    }
  }
}

export default Moonshot;
