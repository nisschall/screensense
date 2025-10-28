const fs = require('fs/promises');
const { OpenAI } = require('openai');
const sharp = require('sharp');

function normalizeAction(action, index) {
  if (!action || typeof action !== 'object') {
    return null;
  }

  const title = typeof action.title === 'string' ? action.title.trim() : '';
  const command = typeof action.command === 'string' ? action.command.trim() : '';
  const notes = typeof action.notes === 'string' ? action.notes.trim() : '';

  if (!title && !command) {
    return null;
  }

  return {
    title: title || (command ? `Action ${index + 1}` : `Action ${index + 1}`),
    command,
    notes
  };
}

function normalizeResource(resource, index) {
  if (!resource || typeof resource !== 'object') {
    return null;
  }

  const title = typeof resource.title === 'string' ? resource.title.trim() : '';
  const url = typeof resource.url === 'string' ? resource.url.trim() : '';
  const reason = typeof resource.reason === 'string' ? resource.reason.trim() : '';

  if (!title && !url && !reason) {
    return null;
  }

  return {
    title: title || (url ? `Resource ${index + 1}` : `Resource ${index + 1}`),
    url,
    reason
  };
}

function extractAssistMetadata(markdown) {
  const blockRegex = /```assist\s*([\s\S]*?)```/i;
  const jsonRegex = /```json\s*([\s\S]*?)```/i;

  const match = blockRegex.exec(markdown) ?? jsonRegex.exec(markdown);
  if (!match) {
    return {
      cleaned: markdown.trim(),
      actions: [],
      resources: []
    };
  }

  let metadata = {};
  try {
    metadata = JSON.parse(match[1]);
  } catch (_error) {
    metadata = {};
  }

  const cleaned = markdown.replace(match[0], '').trim();

  const actionsRaw = Array.isArray(metadata.actions) ? metadata.actions : [];
  const resourcesRaw = Array.isArray(metadata.resources) ? metadata.resources : [];

  const actions = actionsRaw
    .map((item, index) => normalizeAction(item, index))
    .filter(Boolean)
    .slice(0, 5);

  const resources = resourcesRaw
    .map((item, index) => normalizeResource(item, index))
    .filter(Boolean)
    .slice(0, 5);

  return {
    cleaned,
    actions,
    resources
  };
}

async function createClient(apiKey) {
  if (!apiKey) {
    throw new Error('OpenAI API key is not set. Ensure the environment variable is configured.');
  }
  return new OpenAI({
    apiKey
  });
}

async function compressImage(filePath, maxWidth = 1920, quality = 80) {
  try {
    const imageBuffer = await fs.readFile(filePath);
    const metadata = await sharp(imageBuffer).metadata();
    
    // Only compress if image is larger than maxWidth
    if (metadata.width > maxWidth) {
      const compressedBuffer = await sharp(imageBuffer)
        .resize(maxWidth, null, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      
      return compressedBuffer;
    }
    
    // If already small enough, just convert to JPEG with quality compression
    const compressedBuffer = await sharp(imageBuffer)
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    
    return compressedBuffer;
  } catch (error) {
    // If compression fails, fall back to original
    return await fs.readFile(filePath);
  }
}

async function describeScreenshot(filePath, config, logger, options = {}) {
  const apiKeyEnv = config.openai_api_key_env || 'OPENAI_API_KEY';
  const apiKey = process.env[apiKeyEnv];

  if (!config.ai_enabled) {
    logger.info('AI disabled; skipping description');
    return null;
  }

  if (!apiKey) {
    logger.warn(`AI enabled but ${apiKeyEnv} is not set; skipping description`);
    return null;
  }

  const client = await createClient(apiKey);
  
  // Compress image before sending to API (if enabled)
  let imageData;
  const compressionEnabled = config.image_compression?.enabled !== false;
  
  if (compressionEnabled) {
    logger.info('Compressing image for AI analysis');
    const maxWidth = config.image_compression?.max_width || 1920;
    const quality = config.image_compression?.quality || 80;
    
    const compressedImageData = await compressImage(filePath, maxWidth, quality);
    imageData = compressedImageData;
    
    const originalSize = (await fs.stat(filePath)).size;
    const compressedSize = compressedImageData.length;
    const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
    logger.info('Image compressed', { 
      originalSize: `${(originalSize / 1024).toFixed(1)}KB`, 
      compressedSize: `${(compressedSize / 1024).toFixed(1)}KB`,
      saved: `${compressionRatio}%`
    });
  } else {
    logger.info('Image compression disabled, using original');
    imageData = await fs.readFile(filePath);
  }
  
  const base64 = imageData.toString('base64');

  const prompt =
    options.promptOverride ||
    config.ai_prompt ||
    'Describe the key elements of this screenshot in one sentence, including notable UI, text, and context.';

  const model = options.modelOverride || config.ai_model || 'gpt-4o-mini';
  const maxTokens =
    options.maxOutputTokens ||
    config.ai_max_output_tokens ||
    200;

  const response = await client.responses.create({
    model,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          {
            type: 'input_image',
            image_url: `data:image/png;base64,${base64}`
          }
        ]
      }
    ],
    max_output_tokens: maxTokens
  });

  const textParts = [];
  if (response?.output) {
    for (const part of response.output) {
      if (part?.content) {
        for (const segment of part.content) {
          if (segment.type === 'output_text' && segment.text) {
            textParts.push(segment.text.trim());
          }
        }
      }
    }
  }

  const descriptionRaw = textParts.join(' ').trim() || 'AI returned no description.';
  const { cleaned: description, actions, resources } = extractAssistMetadata(descriptionRaw);

  logger.info('AI response received', {
    description,
    actionCount: actions.length,
    resourceCount: resources.length
  });

  return {
    description,
    actions,
    resources,
    model: response?.model ?? config.ai_model,
    responseId: response?.id
  };
}

module.exports = {
  describeScreenshot
};
