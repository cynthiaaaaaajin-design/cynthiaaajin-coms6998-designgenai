export type RuntimeStep={id:string;name:string;prompt:string};
export type RuntimeOutput={step:number;stepId:string;prompt:string;text:string;model:string;duration_ms:number};
export function resolveStepPrompt(template:string,input:string,previous:string):string;
export function buildStepRequest(template:string,input:string,previous:string,index:number):string;
export const itinerarySchema:Record<string,unknown>;
export const proposalSchema:Record<string,unknown>;
export function executeChain(options:{steps:RuntimeStep[];input:string;apiKey:string;model:string;image?:{data:string;mimeType:string};schema?:Record<string,unknown>;onStep?:(output:RuntimeOutput)=>Promise<void>;validate?:(text:string)=>void|Promise<void>;timeout?:number}):Promise<{text:string;trace:RuntimeOutput[]}>;
