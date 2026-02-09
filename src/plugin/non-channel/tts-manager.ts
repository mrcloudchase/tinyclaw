// tts-manager — text-to-speech output after agent runs
import type { TinyClawPluginApi } from "../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "tts-manager",
    name: "TTS Manager",
    version: "0.1.0",
    description: "Text-to-speech post-processing manager",
  });

  api.registerHook("post_run", async (_event, _data) => {
    console.log("TTS manager: checking for TTS");
  });
}
