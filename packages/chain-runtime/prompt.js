export function resolveStepPrompt(template,input,previous) {
  return template.replace(/\{\{(input|previous)\}\}/g,(_,key)=>key==='input'?input:previous);
}
export function buildStepRequest(template,input,previous,index) {
  return `${resolveStepPrompt(template,input,previous)}\n\nOriginal input:\n${input}\n\n${index===0?'Initial input':'Previous step output'}:\n${previous}`;
}
