const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '..', 'config.json');

const DEFAULT_CONFIG = {
  ai_enabled: true,
  ai_model: 'gpt-4o-mini',
  screenshot_folder: 'C:/Users/Default/Pictures/ScreenSense',
  log_limit: 100,
  openai_api_key_env: 'OPENAI_API_KEY',
  capture_shortcut: ['Ctrl+Shift+S', 'Ctrl+Alt+S'],
  ai_prompt: 'Study this screenshot and provide actionable insight in Markdown with the following sections:\n\n**Category**: Classify the overall context in ONE word (Work, Code, Communication, Planning, Entertainment, Browser, Other).\n\n**What I\'m Doing**: Summarize the user\'s current task or intent in 2 short sentences. Mention if they appear to be blocked.\n\n**Key Evidence**:\n- Highlight 2-3 important UI elements, files, or messages that justify the assessment.\n- Quote any critical text verbatim when useful.\n\n**Immediate Suggestions**:\n- List concrete next steps or quick fixes the user can try now.\n- Include links or commands only if they are visible in the screenshot.\n\n**Longer-Term Ideas**:\n- Provide improvement ideas, optimizations, or learning resources relevant to the task.\n\nIf code is visible, include a fenced code block with the most relevant snippet.\n\nFinish with a fenced ```assist code block containing JSON like {\"actions\":[{\"title\":\"Run tests\",\"command\":\"npm test\",\"notes\":\"Copy then run manually.\"}],\"resources\":[{\"title\":\"Docs\",\"url\":\"https://example.com\",\"reason\":\"Reference for the tool in use.\"}]}. Omit properties that would otherwise be empty.',
  ai_enhance_prompt: 'Deliver a deep-dive review of this screenshot in Markdown:\n\n## Situation Overview\n- Describe the end-to-end workflow in progress and why the user is doing it.\n- Identify blockers, risks, or decision points.\n\n## Diagnosis\n- Break down root causes behind any issues, citing on-screen evidence.\n- Map UI elements to their purpose and any related data/variables.\n\n## Recommendations\n- Give step-by-step remedies or improvements, starting with the quickest win.\n- Suggest tooling, references, or examples that match what is shown.\n\n## Optimization & Learning\n- Offer process refinements, automation ideas, or best practices.\n- Share resources (docs, tutorials, patterns) that would help the user advance.\n\n## Reference Snippets\n- Extract the most informative code or command snippets with short explanations.\n\nClose with a fenced ```assist code block containing JSON describing any follow-up {"actions":[...],"resources":[...]}. Remind the user in each note that manual confirmation is required before executing.'
};

function ensureConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

function loadConfig() {
  ensureConfigFile();
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

module.exports = {
  CONFIG_PATH,
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG
};
