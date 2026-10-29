import { createCustomModel } from './modelClient.js';
import { createUserModel } from './modelSettings.js';

// A deployment can keep its text model and supply a separate vision provider.
// Never send documents to a different provider unless explicitly configured.
export function createDocumentModel(database, userId, options = {}) {
  if (process.env.RESUME_VISION_MODEL) {
    return createCustomModel({
      protocol: process.env.RESUME_VISION_PROTOCOL || 'openai',
      baseUrl: process.env.RESUME_VISION_BASE_URL,
      apiKey: process.env.RESUME_VISION_API_KEY,
      model: process.env.RESUME_VISION_MODEL
    });
  }
  return createUserModel(database, userId, options);
}
