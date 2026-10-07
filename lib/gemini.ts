import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { parseActivities } from './itinerary';
import { logGeminiError } from './gemini-errors';

const responseJsonSchema = {
  type: 'object',
  properties: {
    activities: {
      type: 'array',
      minItems: 1,
      // Gemini 3.8 rejects maxItems: 120 here. parseActivities enforces that cap.
      items: {
        type: 'object',
        properties: {
          day_number: { type: 'integer', minimum: 1, maximum: 30 },
          position: { type: 'integer', minimum: 0, maximum: 119 },
          start_time: { type: ['string', 'null'], description: 'Local time HH:MM or null' },
          title: { type: 'string' },
          description: { type: ['string', 'null'] },
          location: { type: ['string', 'null'] },
        },
        required: ['day_number', 'position', 'start_time', 'title', 'description', 'location'],
        additionalProperties: false,
      },
    },
  },
  required: ['activities'],
  additionalProperties: false,
};

export async function generateItinerary(prompt: string, days: number, captureResponse?: (text: string) => void, logErrors = true) {
  let stage = 'Gemini configuration';
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw Object.assign(new Error('GEMINI_API_KEY is not configured on the server.'), { code: 'MISSING_API_KEY' });
    }
    const ai = new GoogleGenAI({ apiKey });
    stage = 'Gemini structured generation (responseFormat)';
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      contents: prompt,
      config: {
        maxOutputTokens: 16000,
        httpOptions: {
          timeout: 90000,
          retryOptions: { attempts: 1 },
          // @google/genai 2.27.0 drops config.responseFormat. Use its supported
          // extraBody escape hatch for the current generateContent REST shape.
          // REST uses APPLICATION_JSON, unlike the MIME string in the SDK guide.
          extraBody: {
            generationConfig: {
              responseFormat: {
                text: { mimeType: 'APPLICATION_JSON', schema: responseJsonSchema },
              },
            },
          },
        },
      },
    });
    captureResponse?.(response.text ?? '');
    stage = 'Gemini response validation';
    if (response.candidates?.[0]?.finishReason !== 'STOP' || !response.text) {
      throw Object.assign(new Error('Gemini did not return a complete itinerary.'), {
        details: { finishReason: response.candidates?.[0]?.finishReason, promptFeedback: response.promptFeedback },
      });
    }
    const responseText = response.text;
    return { responseText, activities: parseActivities(responseText, days) };
  } catch (error) {
    if (logErrors) await logGeminiError(error, stage);
    // Preserve the original SDK error (including status/body) for the route logger.
    throw error;
  }
}
