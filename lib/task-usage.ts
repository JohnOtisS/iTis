export type TaskUsage = {
  input_tokens:number;output_tokens:number;total_tokens:number;reasoning_tokens:number;
  cached_tokens:number;cache_write_tokens:number;tool_cost_usd:number;estimated_cost_usd:number;
  usage_complete:boolean;calls:number;
};
export type ProviderUsage = {input_tokens?:number;output_tokens?:number;input_tokens_details?:{cached_tokens?:number;cache_write_tokens?:number};output_tokens_details?:{reasoning_tokens?:number}};
export function terminalProviderUsage(event:Record<string,unknown>) {
  if(!["response.completed","response.incomplete","response.failed"].includes(String(event.type)))return null;
  const payload=event.response as {usage?:ProviderUsage}|undefined;
  return {usage:payload?.usage,completed:event.type==="response.completed",incomplete:event.type==="response.incomplete"};
}
export function taskUsage(usage?:ProviderUsage, extra:Partial<TaskUsage>={}):TaskUsage {
  const input=usage?.input_tokens??0,output=usage?.output_tokens??0;
  return {input_tokens:input,output_tokens:output,total_tokens:input+output,reasoning_tokens:usage?.output_tokens_details?.reasoning_tokens??0,cached_tokens:usage?.input_tokens_details?.cached_tokens??0,cache_write_tokens:usage?.input_tokens_details?.cache_write_tokens??0,tool_cost_usd:0,estimated_cost_usd:0,usage_complete:Boolean(usage),calls:usage?1:0,...extra};
}
export function estimateModelCost(model:string,usage:ProviderUsage) {
  const u=taskUsage(usage);
  const prices=model==="gpt-6.1-sol"?{input:2,cached:.1,output:10}:{input:.1,cached:.01,output:.5};
  // Cache writes are distinct from ordinary input on supported models. Still an estimate.
  const cached=Math.min(u.input_tokens,u.cached_tokens),written=Math.min(u.input_tokens-cached,u.cache_write_tokens);
  return ((u.input_tokens-cached-written)*prices.input+written*prices.input*1.25+cached*prices.cached+u.output_tokens*prices.output)/1e6;
}
