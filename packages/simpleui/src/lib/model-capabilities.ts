/** Check whether a model ID matches a known vision-capable model family. */
export function isVisionModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes('vision') ||
    id.includes('gpt-4o') ||
    id.includes('gpt-4-turbo') ||
    id.includes('claude-3') ||
    id.includes('claude-3.5') ||
    id.includes('claude-4') ||
    id.startsWith('gemini') ||
    id.includes('gemini-2') ||
    id.includes('llava') ||
    id.includes('pixtral') ||
    id.includes('qwenvl') ||
    id.includes('cogvlm')
  );
}
